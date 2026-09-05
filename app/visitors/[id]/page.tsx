import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { logout } from "@/app/dashboard/actions";
import { createClient } from "@/lib/supabase/server";
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
  searchParams: Promise<{
    error?: string;
    success?: string;
  }>;
};

type Criterion = {
  score?: number;
  evidence?: string;
};

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
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function DetailItem({
  label,
  value,
  href,
}: {
  label: string;
  value: string | number | null;
  href?: string | null;
}) {
  const displayValue = value === null || value === "" ? "—" : String(value);

  return (
    <div className="rounded-xl border border-neutral-100 bg-neutral-50/70 px-4 py-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
        {label}
      </p>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="mt-2 block break-words text-sm font-semibold text-indigo-600 hover:text-indigo-700"
        >
          {displayValue}
        </a>
      ) : (
        <p className="mt-2 break-words text-sm font-semibold text-neutral-800">
          {displayValue}
        </p>
      )}
    </div>
  );
}

function ClassificationBadge({ value }: { value: string }) {
  const className =
    value === "strong_target"
      ? "bg-emerald-50 text-emerald-700"
      : value === "review"
        ? "bg-amber-50 text-amber-700"
        : "bg-neutral-100 text-neutral-600";

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${className}`}>
      {formatLabel(value)}
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  const width = `${Math.max(0, Math.min(100, score))}%`;

  return (
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-100">
      <div
        className="h-full rounded-full bg-neutral-950 transition-all"
        style={{ width }}
      />
    </div>
  );
}

export default async function VisitorDetailPage({
  params,
  searchParams,
}: VisitorDetailPageProps) {
  const { id } = await params;
  const messages = await searchParams;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const userId = typeof claims?.sub === "string" ? claims.sub : null;

  if (!userId) redirect("/login");

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (membershipError || !membership) {
    redirect("/dashboard?error=Your%20team%20membership%20could%20not%20be%20loaded.");
  }

  const organizationId = membership.organization_id as string;
  const email =
    typeof claims?.email === "string" ? claims.email : "Team member";

  const [organizationResult, visitResult] = await Promise.all([
    supabase
      .from("organizations")
      .select("name")
      .eq("id", organizationId)
      .single(),
    supabase
      .from("website_visits")
      .select(
        `
          id,
          organization_id,
          company_id,
          lead_id,
          source,
          page_url,
          page_title,
          referrer_url,
          visitor_id,
          occurred_at,
          payload,
          companies (
            id,
            name,
            domain,
            website_url,
            linkedin_url,
            industry,
            employee_count,
            country,
            metadata
          ),
          leads (
            id,
            first_name,
            last_name,
            job_title,
            email,
            phone,
            linkedin_url,
            status,
            icp_score,
            metadata
          )
        `,
      )
      .eq("organization_id", organizationId)
      .eq("id", id)
      .limit(1)
      .maybeSingle(),
  ]);

  if (visitResult.error) {
    console.error("Could not load visitor detail:", visitResult.error);
  }

  if (!visitResult.data) notFound();

  const visit = visitResult.data as WebsiteVisitRow;
  const model = buildVisitorViewModel(visit);

  let historyResult: { data: unknown[] | null; error: unknown };
  const historySelect = "id, source, page_url, occurred_at, payload";

  if (visit.lead_id) {
    historyResult = await supabase
      .from("website_visits")
      .select(historySelect)
      .eq("organization_id", organizationId)
      .eq("lead_id", visit.lead_id)
      .order("occurred_at", { ascending: false })
      .limit(50);
  } else if (visit.company_id) {
    historyResult = await supabase
      .from("website_visits")
      .select(historySelect)
      .eq("organization_id", organizationId)
      .eq("company_id", visit.company_id)
      .is("lead_id", null)
      .order("occurred_at", { ascending: false })
      .limit(50);
  } else {
    historyResult = await supabase
      .from("website_visits")
      .select(historySelect)
      .eq("organization_id", organizationId)
      .eq("visitor_id", visit.visitor_id)
      .order("occurred_at", { ascending: false })
      .limit(50);
  }

  if (historyResult.error) {
    console.error("Could not load visitor history:", historyResult.error);
  }

  let latestAnalysis: AnalysisRow | null = null;
  let latestDraft: DraftRow | null = null;

  if (visit.lead_id) {
    const [analysisResult, draftResult] = await Promise.all([
      supabase
        .from("lead_analyses")
        .select(
          "id, score, classification, summary, criteria, positive_signals, concerns, missing_information, recommended_angle, model, prompt_version, created_at",
        )
        .eq("organization_id", organizationId)
        .eq("lead_id", visit.lead_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("outreach_drafts")
        .select(
          "id, status, email_subject, email_body, linkedin_connection_note, linkedin_followup, model, prompt_version, approved_at, created_at",
        )
        .eq("organization_id", organizationId)
        .eq("lead_id", visit.lead_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (analysisResult.error) {
      console.error("Could not load latest target analysis:", analysisResult.error);
    } else {
      latestAnalysis = analysisResult.data as AnalysisRow | null;
    }

    if (draftResult.error) {
      console.error("Could not load latest outreach draft:", draftResult.error);
    } else {
      latestDraft = draftResult.data as DraftRow | null;
    }
  }

  const history = (historyResult.data ?? []) as VisitHistoryRow[];
  const organizationName =
    organizationResult.data?.name ?? "Outbound Command Center";
  const isPerson = model.profileType === "person" && Boolean(visit.lead_id);

  return (
    <div className="min-h-screen bg-[#f6f7fb]">
      <header className="border-b border-black/5 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">
              {organizationName}
            </p>
            <h1 className="mt-1 text-xl font-bold">Visitor details</h1>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium">{email}</p>
              <p className="text-xs text-neutral-400">
                {formatLabel(String(membership.role))}
              </p>
            </div>
            <form action={logout}>
              <button
                type="submit"
                className="rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold hover:bg-neutral-50"
              >
                Log out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-8 flex flex-wrap items-center gap-4 text-sm font-semibold">
          <Link href="/dashboard" className="text-indigo-600 hover:text-indigo-700">
            ← Dashboard
          </Link>
          <span className="text-neutral-300">/</span>
          <Link href="/visitors" className="text-indigo-600 hover:text-indigo-700">
            Visitors
          </Link>
        </div>

        {messages.error ? (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {messages.error}
          </div>
        ) : null}

        {messages.success ? (
          <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {messages.success}
          </div>
        ) : null}

        <section className="rounded-3xl border border-black/5 bg-white p-7 shadow-sm sm:p-9">
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-start">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={
                    model.profileType === "person"
                      ? "rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700"
                      : "rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700"
                  }
                >
                  {model.profileType === "person"
                    ? "Person-level visitor"
                    : "Company-level visitor"}
                </span>
                {model.isRepeatVisit ? (
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                    Repeat visit
                  </span>
                ) : null}
                {latestDraft?.status === "approved" ? (
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                    Outreach approved
                  </span>
                ) : null}
              </div>
              <h2 className="mt-5 text-3xl font-bold tracking-tight">
                {model.displayName}
              </h2>
              <p className="mt-2 text-base text-neutral-500">
                {model.profileType === "person"
                  ? [model.jobTitle, model.companyName].filter(Boolean).join(" · ")
                  : model.industry ?? model.companyDomain ?? "Company visitor"}
              </p>
            </div>

            <div className="rounded-2xl bg-neutral-950 px-5 py-4 text-white">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Captured
              </p>
              <p className="mt-2 font-semibold">{formatDateTime(model.occurredAt)}</p>
            </div>
          </div>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
            <h3 className="font-bold">
              {model.profileType === "person" ? "Person details" : "Visitor identity"}
            </h3>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <DetailItem label="Name" value={model.personName ?? model.displayName} />
              <DetailItem label="Job title" value={model.jobTitle} />
              <DetailItem label="Location" value={model.location} />
              <DetailItem label="Email" value={model.email ?? model.maskedEmail} />
              <DetailItem label="Phone" value={model.phone} />
              <DetailItem
                label="LinkedIn"
                value={model.personLinkedInUrl}
                href={model.personLinkedInUrl}
              />
              <DetailItem
                label="Lead status"
                value={model.leadStatus ? formatLabel(model.leadStatus) : null}
              />
              <DetailItem label="ICP score" value={latestAnalysis?.score ?? model.icpScore} />
            </div>
          </section>

          <section className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
            <h3 className="font-bold">Company details</h3>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <DetailItem label="Company" value={model.companyName} />
              <DetailItem label="Industry" value={model.industry} />
              <DetailItem label="Domain" value={model.companyDomain} />
              <DetailItem
                label="Website"
                value={model.companyWebsite}
                href={model.companyWebsite}
              />
              <DetailItem
                label="Company LinkedIn"
                value={model.companyLinkedInUrl}
                href={model.companyLinkedInUrl}
              />
              <DetailItem label="Employees" value={model.employeeCountRaw ?? model.employeeCount} />
              <DetailItem label="Estimated revenue" value={model.estimatedRevenue} />
              <DetailItem label="Location" value={model.location} />
            </div>
          </section>
        </div>

        <section className="mt-6 rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
          <h3 className="font-bold">Visit details</h3>
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <DetailItem
              label="Page viewed"
              value={model.pageTitle ?? model.pageUrl}
              href={model.pageUrl}
            />
            <DetailItem label="Referrer" value={model.referrerUrl} href={model.referrerUrl} />
            <DetailItem label="Page views" value={model.pageViews} />
            <DetailItem label="Source" value={formatLabel(model.source)} />
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-indigo-600">
                AI target analysis
              </p>
              <h3 className="mt-2 text-xl font-bold">Should we contact this person?</h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
                The score uses only the information already stored for this visitor. Missing facts are treated as unknown, not invented.
              </p>
            </div>

            {isPerson ? (
              <form action={analyseTarget}>
                <input type="hidden" name="visitId" value={visit.id} />
                <button
                  type="submit"
                  className="rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800"
                >
                  {latestAnalysis ? "Re-analyse target" : "Analyse target"}
                </button>
              </form>
            ) : null}
          </div>

          {!isPerson ? (
            <div className="mt-6 rounded-2xl border border-violet-100 bg-violet-50 px-5 py-4 text-sm text-violet-800">
              AI person targeting is disabled for company-only visitors. When RB2B identifies a person, the analysis controls will appear here.
            </div>
          ) : latestAnalysis ? (
            <div className="mt-6">
              <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
                <div className="rounded-2xl bg-neutral-950 p-6 text-white">
                  <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                    Target score
                  </p>
                  <p className="mt-3 text-5xl font-bold">{latestAnalysis.score}</p>
                  <p className="mt-1 text-sm text-neutral-400">out of 100</p>
                  <div className="mt-5">
                    <ClassificationBadge value={latestAnalysis.classification} />
                  </div>
                </div>

                <div className="rounded-2xl border border-neutral-100 p-6">
                  <p className="font-semibold">Assessment</p>
                  <p className="mt-3 text-sm leading-6 text-neutral-600">
                    {latestAnalysis.summary}
                  </p>
                  <div className="mt-5 rounded-xl bg-indigo-50 px-4 py-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
                      Recommended angle
                    </p>
                    <p className="mt-2 text-sm leading-6 text-indigo-950">
                      {latestAnalysis.recommended_angle}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {Object.entries(criterionLabels).map(([key, config]) => {
                  const criterion = latestAnalysis.criteria?.[key];
                  const score = typeof criterion?.score === "number" ? criterion.score : 0;
                  const percentage = config.max > 0 ? Math.round((score / config.max) * 100) : 0;

                  return (
                    <div key={key} className="rounded-xl border border-neutral-100 px-4 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold">{config.label}</p>
                        <p className="text-sm font-bold">
                          {score}/{config.max}
                        </p>
                      </div>
                      <ScoreBar score={percentage} />
                      <p className="mt-3 text-xs leading-5 text-neutral-500">
                        {criterion?.evidence || "No evidence supplied."}
                      </p>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-5">
                  <p className="text-sm font-bold text-emerald-800">Positive signals</p>
                  <ul className="mt-3 space-y-2 text-sm leading-5 text-emerald-900">
                    {strings(latestAnalysis.positive_signals).length ? (
                      strings(latestAnalysis.positive_signals).map((item) => (
                        <li key={item}>• {item}</li>
                      ))
                    ) : (
                      <li>• No strong positive signals recorded.</li>
                    )}
                  </ul>
                </div>

                <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-5">
                  <p className="text-sm font-bold text-amber-800">Concerns</p>
                  <ul className="mt-3 space-y-2 text-sm leading-5 text-amber-900">
                    {strings(latestAnalysis.concerns).length ? (
                      strings(latestAnalysis.concerns).map((item) => (
                        <li key={item}>• {item}</li>
                      ))
                    ) : (
                      <li>• No material concerns recorded.</li>
                    )}
                  </ul>
                </div>

                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-5">
                  <p className="text-sm font-bold text-neutral-700">Unknowns</p>
                  <ul className="mt-3 space-y-2 text-sm leading-5 text-neutral-600">
                    {strings(latestAnalysis.missing_information).length ? (
                      strings(latestAnalysis.missing_information).map((item) => (
                        <li key={item}>• {item}</li>
                      ))
                    ) : (
                      <li>• No important information gaps recorded.</li>
                    )}
                  </ul>
                </div>
              </div>

              <p className="mt-4 text-xs text-neutral-400">
                Generated {formatDateTime(latestAnalysis.created_at)} · {latestAnalysis.prompt_version} · {latestAnalysis.model}
              </p>
            </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-dashed border-neutral-200 px-6 py-10 text-center">
              <p className="font-semibold">Not analysed yet</p>
              <p className="mt-2 text-sm text-neutral-500">
                Run the AI analysis before generating personalised outreach.
              </p>
            </div>
          )}
        </section>

        <section className="mt-6 rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-indigo-600">
                Personalised outreach
              </p>
              <h3 className="mt-2 text-xl font-bold">Email + LinkedIn drafts</h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
                AI creates editable drafts only. Nothing is sent until a human approves it and the later Clay/HeyReach launch step is used.
              </p>
            </div>

            {isPerson && latestAnalysis ? (
              <form action={generateOutreach}>
                <input type="hidden" name="visitId" value={visit.id} />
                <button
                  type="submit"
                  className="rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-neutral-50"
                >
                  {latestDraft ? "Regenerate drafts" : "Generate outreach"}
                </button>
              </form>
            ) : null}
          </div>

          {!isPerson ? (
            <p className="mt-6 text-sm text-neutral-500">
              Outreach generation is available for person-level visitors only.
            </p>
          ) : !latestAnalysis ? (
            <p className="mt-6 text-sm text-neutral-500">
              Analyse the target first. The outreach button will appear after the analysis exists.
            </p>
          ) : latestDraft ? (
            <form action={saveOutreachDraft} className="mt-6 space-y-6">
              <input type="hidden" name="visitId" value={visit.id} />
              <input type="hidden" name="draftId" value={latestDraft.id} />

              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={
                    latestDraft.status === "approved"
                      ? "rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"
                      : "rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700"
                  }
                >
                  {formatLabel(latestDraft.status)}
                </span>
                <span className="text-xs text-neutral-400">
                  Generated {formatDateTime(latestDraft.created_at)}
                </span>
              </div>

              {!model.email ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  RB2B has not supplied a usable email address for this person. You can still approve the copy, but Clay will need a valid email before the email campaign can launch.
                </div>
              ) : null}

              <div>
                <label htmlFor="emailSubject" className="mb-2 block text-sm font-semibold">
                  Email subject
                </label>
                <input
                  id="emailSubject"
                  name="emailSubject"
                  required
                  defaultValue={latestDraft.email_subject}
                  className="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                />
              </div>

              <div>
                <label htmlFor="emailBody" className="mb-2 block text-sm font-semibold">
                  Email body
                </label>
                <textarea
                  id="emailBody"
                  name="emailBody"
                  required
                  rows={8}
                  defaultValue={latestDraft.email_body}
                  className="w-full resize-y rounded-xl border border-neutral-200 px-4 py-3 text-sm leading-6 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-4">
                  <label htmlFor="linkedinConnectionNote" className="text-sm font-semibold">
                    LinkedIn connection note
                  </label>
                  <span className="text-xs text-neutral-400">Aim: under 250 characters</span>
                </div>
                <textarea
                  id="linkedinConnectionNote"
                  name="linkedinConnectionNote"
                  required
                  rows={3}
                  defaultValue={latestDraft.linkedin_connection_note}
                  className="w-full resize-y rounded-xl border border-neutral-200 px-4 py-3 text-sm leading-6 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                />
              </div>

              <div>
                <label htmlFor="linkedinFollowup" className="mb-2 block text-sm font-semibold">
                  LinkedIn follow-up
                </label>
                <textarea
                  id="linkedinFollowup"
                  name="linkedinFollowup"
                  required
                  rows={5}
                  defaultValue={latestDraft.linkedin_followup}
                  className="w-full resize-y rounded-xl border border-neutral-200 px-4 py-3 text-sm leading-6 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                />
              </div>

              <div className="flex flex-wrap gap-3 border-t border-neutral-100 pt-5">
                <button
                  type="submit"
                  className="rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-neutral-50"
                >
                  Save changes
                </button>
                <button
                  type="submit"
                  formAction={approveOutreachDraft}
                  className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  {latestDraft.status === "approved" ? "Save + keep approved" : "Approve outreach"}
                </button>
                <button
                  type="button"
                  disabled
                  title="Clay + HeyReach launch is Milestone 7"
                  className="cursor-not-allowed rounded-xl bg-neutral-100 px-4 py-2.5 text-sm font-semibold text-neutral-400"
                >
                  Launch outreach — next milestone
                </button>
              </div>

              <p className="text-xs text-neutral-400">
                {latestDraft.prompt_version} · {latestDraft.model}
                {latestDraft.approved_at
                  ? ` · approved ${formatDateTime(latestDraft.approved_at)}`
                  : ""}
              </p>
            </form>
          ) : (
            <div className="mt-6 rounded-2xl border border-dashed border-neutral-200 px-6 py-10 text-center">
              <p className="font-semibold">No outreach draft yet</p>
              <p className="mt-2 text-sm text-neutral-500">
                Generate email and LinkedIn copy using the approved target context.
              </p>
            </div>
          )}
        </section>

        <section className="mt-6 overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
          <div className="border-b border-neutral-100 px-6 py-5">
            <h3 className="font-bold">Visit history</h3>
            <p className="mt-1 text-sm text-neutral-500">
              {history.length} recorded visit{history.length === 1 ? "" : "s"} for this profile.
            </p>
          </div>

          <div className="divide-y divide-neutral-100">
            {history.map((historyVisit) => (
              <div
                key={historyVisit.id}
                className="flex flex-col justify-between gap-3 px-6 py-5 sm:flex-row sm:items-center"
              >
                <div className="min-w-0">
                  {historyVisit.page_url ? (
                    <a
                      href={historyVisit.page_url}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate font-semibold text-indigo-600 hover:text-indigo-700"
                    >
                      {historyVisit.page_url}
                    </a>
                  ) : (
                    <p className="font-semibold">Page not supplied</p>
                  )}
                  <p className="mt-1 text-xs text-neutral-400">
                    {formatLabel(historyVisit.source)}
                  </p>
                </div>
                <p className="shrink-0 text-sm text-neutral-500">
                  {formatDateTime(historyVisit.occurred_at)}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
