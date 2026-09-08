import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/app/components/app-shell";
import { SectionCard, StatusPill } from "@/app/components/ui";
import { HeyReachLauncher } from "@/app/components/heyreach-launcher";
import { getDashboardContext } from "@/lib/dashboard/context";
import {
  buildVisitorViewModel,
  formatDateTime,
  formatLabel,
  type VisitHistoryRow,
  type WebsiteVisitRow,
} from "@/lib/visitors/presentation";
import {
  analyseTarget,
  approveTargetAndSyncClay,
  approveOutreachDraft,
  generateOutreach,
  saveOutreachDraft,
  syncCompanyToClay,
} from "./actions";

type VisitorDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
};

type Criterion = { score?: number; evidence?: string };
type AnalysisRow = {
  id: string;
  score: number;
  classification: string;
  summary: string;
  research: {
    identity_match?: boolean;
    confidence?: string;
    current_job_title?: string | null;
    current_company?: string | null;
    seniority?: string | null;
    location?: string | null;
    profile_summary?: string | null;
    evidence_notes?: string[];
  } | null;
  research_sources: Array<{ url?: string; title?: string | null }> | null;
  criteria: Record<string, Criterion> | null;
  positive_signals: unknown;
  concerns: unknown;
  missing_information: unknown;
  recommended_angle: string;
  model: string;
  prompt_version: string;
  created_at: string;
};

type DraftRow = {
  id: string;
  status: string;
  email_subject: string;
  email_body: string;
  linkedin_connection_note: string;
  linkedin_followup: string;
  model: string;
  prompt_version: string;
  approved_at: string | null;
  created_at: string;
};

type ClayTargetSyncRow = {
  id: string;
  target_status: string;
  person_status: string;
  company_status: string;
  approved_at: string;
  synced_at: string | null;
  error_message: string | null;
};

type ClayCompanySyncRow = {
  id: string;
  status: string;
  synced_at: string | null;
  error_message: string | null;
};

const criterionLabels: Record<string, { label: string; max: number }> = {
  role_fit: { label: "Role fit", max: 25 },
  company_fit: { label: "Company fit", max: 20 },
  intent_fit: { label: "Intent fit", max: 25 },
  seniority_fit: { label: "Seniority", max: 15 },
  engagement_fit: { label: "Engagement", max: 10 },
  contactability: { label: "Contactability", max: 5 },
};

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function DetailItem({ label, value, href }: { label: string; value: string | number | null; href?: string | null }) {
  const display = value === null || value === "" ? "—" : String(value);
  return (
    <div className="border-b border-slate-100 py-3 last:border-b-0">
      <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">{label}</p>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="mt-1.5 block max-w-full truncate text-sm font-semibold text-indigo-600 hover:text-indigo-700">{display} ↗</a>
      ) : (
        <p className="mt-1.5 break-words text-sm font-semibold text-slate-700">{display}</p>
      )}
    </div>
  );
}

function classificationTone(value: string) {
  if (value === "strong_target") return { card: "border-emerald-200 bg-emerald-50/70", pill: "green" as const, bar: "bg-emerald-400" };
  if (value === "review") return { card: "border-amber-200 bg-amber-50/70", pill: "amber" as const, bar: "bg-amber-400" };
  return { card: "border-slate-200 bg-slate-50", pill: "neutral" as const, bar: "bg-slate-400" };
}

export default async function VisitorDetailPage({ params, searchParams }: VisitorDetailPageProps) {
  const { id } = await params;
  const messages = await searchParams;
  const { supabase, organizationId, organizationName, email, role } = await getDashboardContext();

  const { data: visitData, error: visitError } = await supabase
    .from("website_visits")
    .select(`
      id, organization_id, company_id, lead_id, source, page_url, page_title,
      referrer_url, visitor_id, occurred_at, payload,
      companies (id, name, domain, website_url, linkedin_url, industry, employee_count, country, metadata),
      leads (id, first_name, last_name, job_title, email, phone, linkedin_url, status, icp_score, metadata)
    `)
    .eq("organization_id", organizationId)
    .eq("id", id)
    .limit(1)
    .maybeSingle();

  if (visitError) console.error("Could not load visitor detail:", visitError);
  if (!visitData) notFound();

  const visit = visitData as WebsiteVisitRow;
  const model = buildVisitorViewModel(visit);
  const isPerson = model.profileType === "person" && Boolean(visit.lead_id);

  let history: VisitHistoryRow[] = [];
  const historySelect = "id, source, page_url, occurred_at, payload";

  if (visit.lead_id) {
    const result = await supabase.from("website_visits").select(historySelect).eq("organization_id", organizationId).eq("lead_id", visit.lead_id).order("occurred_at", { ascending: false }).limit(50);
    history = (result.data ?? []) as VisitHistoryRow[];
  } else if (visit.company_id) {
    const result = await supabase.from("website_visits").select(historySelect).eq("organization_id", organizationId).eq("company_id", visit.company_id).is("lead_id", null).order("occurred_at", { ascending: false }).limit(50);
    history = (result.data ?? []) as VisitHistoryRow[];
  } else if (visit.visitor_id) {
    const result = await supabase.from("website_visits").select(historySelect).eq("organization_id", organizationId).eq("visitor_id", visit.visitor_id).order("occurred_at", { ascending: false }).limit(50);
    history = (result.data ?? []) as VisitHistoryRow[];
  }

  let latestAnalysis: AnalysisRow | null = null;
  let latestDraft: DraftRow | null = null;
  let clayTargetSync: ClayTargetSyncRow | null = null;
  let clayCompanySync: ClayCompanySyncRow | null = null;

  if (visit.lead_id) {
    const [analysisResult, draftResult, claySyncResult] = await Promise.all([
      supabase
        .from("lead_analyses")
        .select("id, score, classification, summary, research, research_sources, criteria, positive_signals, concerns, missing_information, recommended_angle, model, prompt_version, created_at")
        .eq("organization_id", organizationId)
        .eq("lead_id", visit.lead_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("outreach_drafts")
        .select("id, status, email_subject, email_body, linkedin_connection_note, linkedin_followup, model, prompt_version, approved_at, created_at")
        .eq("organization_id", organizationId)
        .eq("lead_id", visit.lead_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("clay_target_syncs")
        .select("id, target_status, person_status, company_status, approved_at, synced_at, error_message")
        .eq("organization_id", organizationId)
        .eq("lead_id", visit.lead_id)
        .limit(1)
        .maybeSingle(),
    ]);
    latestAnalysis = analysisResult.data as AnalysisRow | null;
    latestDraft = draftResult.data as DraftRow | null;
    clayTargetSync = claySyncResult.data as ClayTargetSyncRow | null;
  }

  if (visit.company_id) {
    const companySyncResult = await supabase
      .from("clay_company_syncs")
      .select("id, status, synced_at, error_message")
      .eq("organization_id", organizationId)
      .eq("company_id", visit.company_id)
      .limit(1)
      .maybeSingle();

    if (companySyncResult.error) {
      console.error("Could not load Clay company sync:", companySyncResult.error);
    } else {
      clayCompanySync = companySyncResult.data as ClayCompanySyncRow | null;
    }
  }

  const tone = latestAnalysis
    ? classificationTone(latestAnalysis.classification)
    : null;
  const targetApproved = clayTargetSync?.target_status === "approved";
  const clayReady = Boolean(
    targetApproved &&
      clayTargetSync?.person_status === "synced" &&
      (clayTargetSync?.company_status === "synced" ||
        clayTargetSync?.company_status === "skipped"),
  );
  const companyClaySynced =
    clayCompanySync?.status === "synced" ||
    clayTargetSync?.company_status === "synced";

  return (
    <AppShell
      active="visitors"
      organizationName={organizationName}
      email={email}
      role={role}
      title={model.displayName}
      eyebrow="Visitor profile"
      description={model.profileType === "person" ? [model.jobTitle, model.companyName].filter(Boolean).join(" · ") || "Person-level RB2B visitor" : model.industry ?? model.companyDomain ?? "Company-level RB2B visitor"}
      actions={<Link href="/visitors" className="inline-flex rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:border-indigo-200 hover:text-indigo-700">← Back to visitors</Link>}
    >
      {messages.error ? <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{messages.error}</div> : null}
      {messages.success ? <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{messages.success}</div> : null}

      <div className="mb-5 flex flex-wrap gap-2">
        <StatusPill tone={model.profileType === "person" ? "blue" : "indigo"}>{model.profileType === "person" ? "Person-level visitor" : "Company-level visitor"}</StatusPill>
        {model.personLinkedInUrl ? <StatusPill tone="indigo">Person LinkedIn available</StatusPill> : null}
        {model.companyLinkedInUrl ? <StatusPill tone="blue">Company LinkedIn available</StatusPill> : null}
        {model.isRepeatVisit ? <StatusPill tone="amber">Repeat visit</StatusPill> : null}
        {targetApproved ? <StatusPill tone="green">Target approved</StatusPill> : null}
        {clayReady ? <StatusPill tone="blue">Clay synced</StatusPill> : null}
        {latestDraft?.status === "approved" ? <StatusPill tone="green">Outreach approved</StatusPill> : null}
      </div>

      <div className={`grid gap-5 ${isPerson ? "xl:grid-cols-[0.9fr_0.9fr_1.2fr]" : "lg:grid-cols-2"}`}>
        {isPerson ? (
          <SectionCard className="p-5 sm:p-6">
            <div className="flex items-center justify-between"><h2 className="font-bold text-slate-900">Person</h2><span className="text-xs text-slate-400">RB2B</span></div>
            <div className="mt-3">
              <DetailItem label="Name" value={model.personName ?? model.displayName} href={model.personLinkedInUrl} />
              <DetailItem label="Job title" value={model.jobTitle} />
              <DetailItem label="Location" value={model.location} />
              <DetailItem label="Email" value={model.email ?? model.maskedEmail} />
              <DetailItem label="LinkedIn" value={model.personLinkedInUrl ? "View person profile" : null} href={model.personLinkedInUrl} />
            </div>
          </SectionCard>
        ) : null}

        <SectionCard className="p-5 sm:p-6">
          <div className="flex items-center justify-between"><h2 className="font-bold text-slate-900">Company</h2><span className="text-xs text-slate-400">Account</span></div>
          <div className="mt-3">
            <DetailItem label="Company" value={model.companyName} href={model.companyLinkedInUrl} />
            <DetailItem label="Industry" value={model.industry} />
            <DetailItem label="Employees" value={model.employeeCountRaw ?? model.employeeCount} />
            <DetailItem label="Website" value={model.companyWebsite ?? model.companyDomain} href={model.companyWebsite} />
            <DetailItem label="Company LinkedIn" value={model.companyLinkedInUrl ? "View company profile" : null} href={model.companyLinkedInUrl} />
          </div>
        </SectionCard>

        <SectionCard className="p-5 sm:p-6">
          <div className="flex items-center justify-between"><h2 className="font-bold text-slate-900">Intent</h2><span className="text-xs text-slate-400">Last seen {formatDateTime(model.occurredAt)}</span></div>
          <div className="mt-3">
            <DetailItem label="Page viewed" value={model.pageTitle ?? model.pageUrl} href={model.pageUrl} />
            <DetailItem label="Page views" value={model.pageViews ?? history.length} />
            <DetailItem label="Repeat visitor" value={model.isRepeatVisit ? "Yes" : "No"} />
            <DetailItem label="Referrer" value={model.referrerUrl} href={model.referrerUrl} />
            <DetailItem label="Source" value={formatLabel(model.source)} />
          </div>
        </SectionCard>
      </div>

      {!isPerson ? (
        <SectionCard className="mt-5 overflow-hidden">
          <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-sky-600">Clay company list</p>
              <h2 className="mt-2 text-lg font-bold text-slate-900">Add this company to Companies from RB2B (Manual)</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                This sends the company record to your existing Clay webhook with <span className="font-semibold text-slate-700">record_type = company</span>. Clay then routes it into <span className="font-semibold text-slate-700">Companies from RB2B (Manual)</span>.
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                <span className="rounded-lg bg-slate-50 px-2.5 py-1.5">{model.companyName}</span>
                {model.companyLinkedInUrl ? <span className="rounded-lg bg-indigo-50 px-2.5 py-1.5 text-indigo-700">LinkedIn included ✓</span> : <span className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-amber-700">No company LinkedIn captured</span>}
                {model.companyWebsite ? <span className="rounded-lg bg-sky-50 px-2.5 py-1.5 text-sky-700">Website included ✓</span> : null}
              </div>
            </div>

            <form action={syncCompanyToClay} className="w-full lg:w-auto">
              <input type="hidden" name="visitId" value={visit.id} />
              <button
                type="submit"
                disabled={companyClaySynced}
                className={
                  companyClaySynced
                    ? "w-full cursor-default rounded-xl bg-emerald-100 px-5 py-3 text-sm font-bold text-emerald-700 lg:w-auto"
                    : "w-full rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-indigo-700 lg:w-auto"
                }
              >
                {companyClaySynced
                  ? "Added to Clay Companies ✓"
                  : clayCompanySync?.status === "failed"
                    ? "Retry add to Clay"
                    : "Add company to Clay →"}
              </button>
            </form>
          </div>

          {clayCompanySync?.error_message ? (
            <div className="border-t border-amber-100 bg-amber-50 px-5 py-3 text-xs leading-5 text-amber-800 sm:px-6">
              {clayCompanySync.error_message}
            </div>
          ) : null}
        </SectionCard>
      ) : null}

      {isPerson ? (
      <SectionCard className="mt-5 p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-indigo-600">AI fit analysis</p>
            <h2 className="mt-2 text-xl font-bold text-slate-900">How well does this visitor match our outbound criteria?</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">The AI checks the professional public web first, starting from the LinkedIn URL when available, then combines verified role/company evidence with the RB2B visit signals.</p>
          </div>
          {isPerson ? (
            <form action={analyseTarget}>
              <input type="hidden" name="visitId" value={visit.id} />
              <button className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">{latestAnalysis ? "Re-analyse target" : "Analyse target"}</button>
            </form>
          ) : null}
        </div>

        {!isPerson ? (
          <div className="mt-5 rounded-xl border border-violet-100 bg-violet-50 px-4 py-4 text-sm text-violet-700">AI person targeting becomes available when RB2B identifies an individual visitor.</div>
        ) : latestAnalysis && tone ? (
          <div className="mt-6">
            <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
              <div className={`rounded-2xl border p-5 ${tone.card}`}>
                <p className="text-xs font-bold uppercase tracking-[0.1em] text-slate-500">AI target score</p>
                <div className="mt-3 flex items-end gap-2"><span className="text-5xl font-bold tracking-tight text-slate-900">{latestAnalysis.score}</span><span className="pb-1 text-sm text-slate-400">/100</span></div>
                <div className="mt-4"><StatusPill tone={tone.pill}>{formatLabel(latestAnalysis.classification)}</StatusPill></div>
                <p className="mt-3 text-xs leading-5 text-slate-500">80–100 Strong target · 60–79 Review · 0–59 Low priority. Human approval is still required.</p>
              </div>
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/55 p-5">
                <p className="text-xs font-bold uppercase tracking-[0.1em] text-indigo-600">Recommended angle</p>
                <p className="mt-3 text-sm leading-6 text-indigo-950">{latestAnalysis.recommended_angle}</p>
                <p className="mt-4 border-t border-indigo-100 pt-4 text-sm leading-6 text-slate-600">{latestAnalysis.summary}</p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {Object.entries(criterionLabels).map(([key, config]) => {
                const criterion = latestAnalysis.criteria?.[key];
                const score = typeof criterion?.score === "number" ? criterion.score : 0;
                const percentage = Math.max(0, Math.min(100, Math.round((score / config.max) * 100)));
                return (
                  <div key={key} className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between"><p className="text-sm font-semibold text-slate-700">{config.label}</p><p className="text-sm font-bold text-slate-900">{score}/{config.max}</p></div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${percentage}%` }} /></div>
                    <p className="mt-3 text-xs leading-5 text-slate-500">{criterion?.evidence || "No evidence supplied."}</p>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/55 p-4"><p className="text-sm font-bold text-emerald-700">Positive signals</p><ul className="mt-3 space-y-2 text-sm leading-5 text-emerald-900">{strings(latestAnalysis.positive_signals).length ? strings(latestAnalysis.positive_signals).map((item) => <li key={item}>• {item}</li>) : <li>• No strong positive signals recorded.</li>}</ul></div>
              <div className="rounded-xl border border-amber-100 bg-amber-50/55 p-4"><p className="text-sm font-bold text-amber-700">Concerns</p><ul className="mt-3 space-y-2 text-sm leading-5 text-amber-900">{strings(latestAnalysis.concerns).length ? strings(latestAnalysis.concerns).map((item) => <li key={item}>• {item}</li>) : <li>• No material concerns recorded.</li>}</ul></div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4"><p className="text-sm font-bold text-slate-700">Unknowns</p><ul className="mt-3 space-y-2 text-sm leading-5 text-slate-600">{strings(latestAnalysis.missing_information).length ? strings(latestAnalysis.missing_information).map((item) => <li key={item}>• {item}</li>) : <li>• No important information gaps recorded.</li>}</ul></div>
            </div>

            <div className="mt-4 rounded-2xl border border-sky-100 bg-sky-50/45 p-4 sm:p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.1em] text-sky-700">Professional web research</p>
                  <h3 className="mt-1 text-sm font-bold text-slate-900">LinkedIn + corroborating public sources</h3>
                </div>
                <StatusPill tone={latestAnalysis.research?.confidence === "high" ? "green" : latestAnalysis.research?.confidence === "medium" ? "amber" : "neutral"}>
                  {latestAnalysis.research?.confidence ? `${formatLabel(latestAnalysis.research.confidence)} confidence` : "No confidence"}
                </StatusPill>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <DetailItem label="Researched role" value={latestAnalysis.research?.current_job_title ?? "—"} />
                <DetailItem label="Researched company" value={latestAnalysis.research?.current_company ?? "—"} />
                <DetailItem label="Seniority" value={latestAnalysis.research?.seniority ?? "—"} />
                <DetailItem label="Location" value={latestAnalysis.research?.location ?? "—"} />
              </div>

              {latestAnalysis.research?.profile_summary ? (
                <p className="mt-4 text-sm leading-6 text-slate-600">{latestAnalysis.research.profile_summary}</p>
              ) : null}

              {strings(latestAnalysis.research?.evidence_notes).length ? (
                <ul className="mt-3 space-y-1.5 text-xs leading-5 text-slate-500">
                  {strings(latestAnalysis.research?.evidence_notes).map((item) => <li key={item}>• {item}</li>)}
                </ul>
              ) : null}

              {Array.isArray(latestAnalysis.research_sources) && latestAnalysis.research_sources.length ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {latestAnalysis.research_sources.slice(0, 6).map((source, index) => source?.url ? (
                    <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer" className="rounded-lg border border-sky-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-sky-700 hover:border-sky-300">
                      {source.title || `Source ${index + 1}`} ↗
                    </a>
                  ) : null)}
                </div>
              ) : null}
            </div>
            <div className="mt-5 rounded-2xl border border-violet-100 bg-violet-50/45 p-4 sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-violet-600">Human target approval</p>
                  <h3 className="mt-1.5 font-bold text-slate-900">Approve this person before outreach</h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Approval does not send any email or LinkedIn message. It only marks the person as a qualified target and syncs the person to Clay People plus their company to Clay Companies.</p>
                </div>
                <form action={approveTargetAndSyncClay} className="shrink-0">
                  <input type="hidden" name="visitId" value={visit.id} />
                  <input type="hidden" name="analysisId" value={latestAnalysis.id} />
                  <button
                    type="submit"
                    disabled={clayReady}
                    className={clayReady ? "cursor-default rounded-xl bg-emerald-100 px-4 py-2.5 text-sm font-semibold text-emerald-700" : "rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700"}
                  >
                    {clayReady ? "Approved + synced to Clay ✓" : targetApproved ? "Retry Clay sync" : "Approve target + sync to Clay"}
                  </button>
                </form>
              </div>

              {clayTargetSync ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-white/80 bg-white/80 p-3.5">
                    <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">Decision</p>
                    <p className="mt-1.5 text-sm font-semibold text-slate-700">{targetApproved ? "Approved" : formatLabel(clayTargetSync.target_status)}</p>
                  </div>
                  <div className="rounded-xl border border-white/80 bg-white/80 p-3.5">
                    <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">Clay People</p>
                    <p className="mt-1.5 text-sm font-semibold text-slate-700">{formatLabel(clayTargetSync.person_status)}</p>
                  </div>
                  <div className="rounded-xl border border-white/80 bg-white/80 p-3.5">
                    <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">Clay Company</p>
                    <p className="mt-1.5 text-sm font-semibold text-slate-700">{formatLabel(clayTargetSync.company_status)}</p>
                  </div>
                </div>
              ) : null}

              {clayTargetSync?.error_message ? (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">{clayTargetSync.error_message}</div>
              ) : null}
            </div>

            <p className="mt-4 text-xs text-slate-400">Generated {formatDateTime(latestAnalysis.created_at)} · {latestAnalysis.prompt_version} · {latestAnalysis.model}</p>
          </div>
        ) : (
          <div className="mt-6 rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-6 py-10 text-center"><p className="font-semibold text-slate-700">Not analysed yet</p><p className="mt-2 text-sm text-slate-500">Run the AI analysis to score this person and unlock personalised outreach.</p></div>
        )}
      </SectionCard>
      ) : null}

      {isPerson ? (
      <SectionCard className="mt-5 p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-indigo-600">Personalised Outreach</p>
            <h2 className="mt-2 text-xl font-bold text-slate-900">Email + LinkedIn drafts</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">After the target is approved and synced to Clay, generate and review the personalised email + LinkedIn copy. Nothing sends at this stage.</p>
          </div>
          {isPerson && latestAnalysis && clayReady ? (
            <form action={generateOutreach}><input type="hidden" name="visitId" value={visit.id} /><button className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100">{latestDraft ? "Regenerate drafts" : "Generate outreach"}</button></form>
          ) : null}
        </div>

        {!isPerson ? (
          <p className="mt-5 text-sm text-slate-500">Outreach generation is available for person-level visitors only.</p>
        ) : !latestAnalysis ? (
          <p className="mt-5 text-sm text-slate-500">Analyse the target first.</p>
        ) : !clayReady ? (
          <div className="mt-5 rounded-xl border border-violet-100 bg-violet-50 px-4 py-4 text-sm text-violet-700">Approve the target and complete the Clay People/Companies sync above before generating outreach.</div>
        ) : latestDraft ? (
          <form action={saveOutreachDraft} className="mt-6">
            <input type="hidden" name="visitId" value={visit.id} />
            <input type="hidden" name="draftId" value={latestDraft.id} />
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <StatusPill tone={latestDraft.status === "approved" ? "green" : "amber"}>{formatLabel(latestDraft.status)}</StatusPill>
              <span className="text-xs text-slate-400">Generated {formatDateTime(latestDraft.created_at)}</span>
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <div className="rounded-2xl border border-sky-100 bg-sky-50/35 p-4 sm:p-5">
                <div className="mb-4 flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.12em] text-sky-600">Email</p><h3 className="mt-1 font-bold text-slate-900">Clay copy</h3></div>{model.email ? <StatusPill tone="green">Email ready</StatusPill> : <StatusPill tone="amber">Email missing</StatusPill>}</div>
                {!model.email ? <div className="mb-4 rounded-xl border border-amber-100 bg-amber-50 px-3.5 py-3 text-xs leading-5 text-amber-800">RB2B has not supplied a usable email. The copy can still be approved, but Clay will need a valid email before launch.</div> : null}
                <label htmlFor="emailSubject" className="mb-2 block text-xs font-bold text-slate-600">Subject</label>
                <input id="emailSubject" name="emailSubject" required defaultValue={latestDraft.email_subject} className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50" />
                <label htmlFor="emailBody" className="mb-2 mt-4 block text-xs font-bold text-slate-600">Message</label>
                <textarea id="emailBody" name="emailBody" required rows={11} defaultValue={latestDraft.email_body} className="w-full resize-y rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50" />
              </div>

              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/35 p-4 sm:p-5">
                <div className="mb-4 flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.12em] text-indigo-600">LinkedIn</p><h3 className="mt-1 font-bold text-slate-900">HeyReach copy</h3></div>{model.personLinkedInUrl ? <StatusPill tone="green">Profile ready</StatusPill> : <StatusPill tone="amber">Profile missing</StatusPill>}</div>
                <label htmlFor="linkedinConnectionNote" className="mb-2 block text-xs font-bold text-slate-600">Connection note <span className="font-normal text-slate-400">· aim under 250 chars</span></label>
                <textarea id="linkedinConnectionNote" name="linkedinConnectionNote" required rows={5} defaultValue={latestDraft.linkedin_connection_note} className="w-full resize-y rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50" />
                <label htmlFor="linkedinFollowup" className="mb-2 mt-4 block text-xs font-bold text-slate-600">Follow-up</label>
                <textarea id="linkedinFollowup" name="linkedinFollowup" required rows={8} defaultValue={latestDraft.linkedin_followup} className="w-full resize-y rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50" />
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-5">
              <button type="submit" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:border-indigo-200 hover:text-indigo-700">Save changes</button>
              <button type="submit" formAction={approveOutreachDraft} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700">{latestDraft.status === "approved" ? "Save + keep approved" : "Approve outreach"}</button>
              <HeyReachLauncher draftId={latestDraft.id} approved={latestDraft.status === "approved"} linkedinReady={Boolean(model.personLinkedInUrl)} />
              <span className="ml-auto text-xs text-slate-400">{latestDraft.prompt_version} · {latestDraft.model}{latestDraft.approved_at ? ` · approved ${formatDateTime(latestDraft.approved_at)}` : ""}</span>
            </div>
          </form>
        ) : (
          <div className="mt-6 rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-6 py-10 text-center"><p className="font-semibold text-slate-700">No outreach draft yet</p><p className="mt-2 text-sm text-slate-500">Generate personalised email and LinkedIn copy from the target analysis.</p></div>
        )}
      </SectionCard>
      ) : null}

      <SectionCard className="mt-5 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-5 sm:px-6"><div><h2 className="font-bold text-slate-900">Visit history</h2><p className="mt-1 text-sm text-slate-500">{history.length} recorded visit{history.length === 1 ? "" : "s"} for this profile.</p></div></div>
        {history.length ? <div className="divide-y divide-slate-100">{history.map((historyVisit) => <div key={historyVisit.id} className="flex flex-col justify-between gap-2 px-5 py-4 sm:flex-row sm:items-center sm:px-6"><div className="min-w-0">{historyVisit.page_url ? <a href={historyVisit.page_url} target="_blank" rel="noreferrer" className="block truncate text-sm font-semibold text-indigo-600 hover:text-indigo-700">{historyVisit.page_url}</a> : <p className="text-sm font-semibold text-slate-700">Page not supplied</p>}<p className="mt-1 text-xs text-slate-400">{formatLabel(historyVisit.source)}</p></div><p className="shrink-0 text-xs text-slate-500">{formatDateTime(historyVisit.occurred_at)}</p></div>)}</div> : <div className="px-6 py-10 text-center text-sm text-slate-500">No visit history recorded.</div>}
      </SectionCard>
    </AppShell>
  );
}
