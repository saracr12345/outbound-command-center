import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/app/components/app-shell";
import { SectionCard, StatusPill } from "@/app/components/ui";
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
  approveOutreachDraft,
  generateOutreach,
  saveOutreachDraft,
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

  if (visit.lead_id) {
    const [analysisResult, draftResult] = await Promise.all([
      supabase
        .from("lead_analyses")
        .select("id, score, classification, summary, criteria, positive_signals, concerns, missing_information, recommended_angle, model, prompt_version, created_at")
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
    ]);
    latestAnalysis = analysisResult.data as AnalysisRow | null;
    latestDraft = draftResult.data as DraftRow | null;
  }

  const tone = latestAnalysis ? classificationTone(latestAnalysis.classification) : null;

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
        {model.personLinkedInUrl ? <StatusPill tone="indigo">LinkedIn available</StatusPill> : null}
        {model.isRepeatVisit ? <StatusPill tone="amber">Repeat visit</StatusPill> : null}
        {latestDraft?.status === "approved" ? <StatusPill tone="green">Outreach approved</StatusPill> : null}
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.9fr_0.9fr_1.2fr]">
        <SectionCard className="p-5 sm:p-6">
          <div className="flex items-center justify-between"><h2 className="font-bold text-slate-900">Person</h2><span className="text-xs text-slate-400">RB2B</span></div>
          <div className="mt-3">
            <DetailItem label="Name" value={model.personName ?? model.displayName} />
            <DetailItem label="Job title" value={model.jobTitle} />
            <DetailItem label="Location" value={model.location} />
            <DetailItem label="Email" value={model.email ?? model.maskedEmail} />
            <DetailItem label="LinkedIn" value={model.personLinkedInUrl ? "View person profile" : null} href={model.personLinkedInUrl} />
          </div>
        </SectionCard>

        <SectionCard className="p-5 sm:p-6">
          <div className="flex items-center justify-between"><h2 className="font-bold text-slate-900">Company</h2><span className="text-xs text-slate-400">Account</span></div>
          <div className="mt-3">
            <DetailItem label="Company" value={model.companyName} />
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

      <SectionCard className="mt-5 p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-indigo-600">AI Target Analysis</p>
            <h2 className="mt-2 text-xl font-bold text-slate-900">Should we contact this person?</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Scoring uses only the visitor and company evidence already stored in the dashboard. Unknown information is not invented.</p>
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
                <p className="text-xs font-bold uppercase tracking-[0.1em] text-slate-500">Target score</p>
                <div className="mt-3 flex items-end gap-2"><span className="text-5xl font-bold tracking-tight text-slate-900">{latestAnalysis.score}</span><span className="pb-1 text-sm text-slate-400">/100</span></div>
                <div className="mt-4"><StatusPill tone={tone.pill}>{formatLabel(latestAnalysis.classification)}</StatusPill></div>
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
            <p className="mt-4 text-xs text-slate-400">Generated {formatDateTime(latestAnalysis.created_at)} · {latestAnalysis.prompt_version} · {latestAnalysis.model}</p>
          </div>
        ) : (
          <div className="mt-6 rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-6 py-10 text-center"><p className="font-semibold text-slate-700">Not analysed yet</p><p className="mt-2 text-sm text-slate-500">Run the AI analysis to score this person and unlock personalised outreach.</p></div>
        )}
      </SectionCard>

      <SectionCard className="mt-5 p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-indigo-600">Personalised Outreach</p>
            <h2 className="mt-2 text-xl font-bold text-slate-900">Email + LinkedIn drafts</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Drafts remain editable and nothing is sent until a human approves the copy. Launching through Clay and HeyReach comes next.</p>
          </div>
          {isPerson && latestAnalysis ? (
            <form action={generateOutreach}><input type="hidden" name="visitId" value={visit.id} /><button className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100">{latestDraft ? "Regenerate drafts" : "Generate outreach"}</button></form>
          ) : null}
        </div>

        {!isPerson ? (
          <p className="mt-5 text-sm text-slate-500">Outreach generation is available for person-level visitors only.</p>
        ) : !latestAnalysis ? (
          <p className="mt-5 text-sm text-slate-500">Analyse the target first.</p>
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
              <button type="button" disabled title="HeyReach + Clay integration is the next milestone" className="cursor-not-allowed rounded-xl bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-300 ring-1 ring-indigo-100">Launch outreach — next</button>
              <span className="ml-auto text-xs text-slate-400">{latestDraft.prompt_version} · {latestDraft.model}{latestDraft.approved_at ? ` · approved ${formatDateTime(latestDraft.approved_at)}` : ""}</span>
            </div>
          </form>
        ) : (
          <div className="mt-6 rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-6 py-10 text-center"><p className="font-semibold text-slate-700">No outreach draft yet</p><p className="mt-2 text-sm text-slate-500">Generate personalised email and LinkedIn copy from the target analysis.</p></div>
        )}
      </SectionCard>

      <SectionCard className="mt-5 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-5 sm:px-6"><div><h2 className="font-bold text-slate-900">Visit history</h2><p className="mt-1 text-sm text-slate-500">{history.length} recorded visit{history.length === 1 ? "" : "s"} for this profile.</p></div></div>
        {history.length ? <div className="divide-y divide-slate-100">{history.map((historyVisit) => <div key={historyVisit.id} className="flex flex-col justify-between gap-2 px-5 py-4 sm:flex-row sm:items-center sm:px-6"><div className="min-w-0">{historyVisit.page_url ? <a href={historyVisit.page_url} target="_blank" rel="noreferrer" className="block truncate text-sm font-semibold text-indigo-600 hover:text-indigo-700">{historyVisit.page_url}</a> : <p className="text-sm font-semibold text-slate-700">Page not supplied</p>}<p className="mt-1 text-xs text-slate-400">{formatLabel(historyVisit.source)}</p></div><p className="shrink-0 text-xs text-slate-500">{formatDateTime(historyVisit.occurred_at)}</p></div>)}</div> : <div className="px-6 py-10 text-center text-sm text-slate-500">No visit history recorded.</div>}
      </SectionCard>
    </AppShell>
  );
}
