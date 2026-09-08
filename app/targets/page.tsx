import Link from "next/link";
import { AppShell } from "@/app/components/app-shell";
import { MetricCard, SectionCard, StatusPill } from "@/app/components/ui";
import { getDashboardContext } from "@/lib/dashboard/context";


type CompanyRelation = {
  name: string;
  domain: string | null;
  linkedin_url: string | null;
};

type LeadRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  linkedin_url: string | null;
  status: string;
  icp_score: number | null;
  companies: CompanyRelation | CompanyRelation[] | null;
};

type VisitRow = {
  id: string;
  lead_id: string | null;
  occurred_at: string;
};

function company(value: LeadRow["companies"]) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function name(lead: LeadRow) {
  return (
    [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim() ||
    "Unnamed person"
  );
}

function priority(score: number | null) {
  const value = score ?? 0;
  if (value >= 80) return { label: "Strong target", tone: "green" as const };
  if (value >= 60) return { label: "Review", tone: "amber" as const };
  return { label: "Low priority", tone: "neutral" as const };
}

export default async function TargetsPage() {
  const { supabase, organizationId, organizationName, email, role } =
    await getDashboardContext();

  const { data } = await supabase
    .from("leads")
    .select(
      "id, first_name, last_name, job_title, linkedin_url, status, icp_score, companies (name, domain, linkedin_url)",
    )
    .eq("organization_id", organizationId)
    .not("icp_score", "is", null)
    .order("icp_score", { ascending: false })
    .limit(250);

  const leads = (data ?? []) as LeadRow[];
  const strong = leads.filter((lead) => (lead.icp_score ?? 0) >= 80).length;
  const review = leads.filter(
    (lead) => (lead.icp_score ?? 0) >= 60 && (lead.icp_score ?? 0) < 80,
  ).length;
  const low = leads.filter((lead) => (lead.icp_score ?? 0) < 60).length;

  const visitMap = new Map<string, string>();

  if (leads.length) {
    const { data: visits } = await supabase
      .from("website_visits")
      .select("id, lead_id, occurred_at")
      .eq("organization_id", organizationId)
      .in(
        "lead_id",
        leads.map((lead) => lead.id),
      )
      .order("occurred_at", { ascending: false });

    for (const visit of (visits ?? []) as VisitRow[]) {
      if (visit.lead_id && !visitMap.has(visit.lead_id)) {
        visitMap.set(visit.lead_id, visit.id);
      }
    }
  }

  return (
    <AppShell
      active="targets"
      organizationName={organizationName}
      email={email}
      role={role}
      title="AI Targets"
      description="Priority combines public professional research with RB2B role, company, intent, seniority, engagement and contactability evidence."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard
          label="Strong targets"
          value={strong}
          note="80–100"
          tone="green"
        />
        <MetricCard label="Review" value={review} note="60–79" tone="amber" />
        <MetricCard
          label="Low priority"
          value={low}
          note="0–59"
          tone="indigo"
        />
      </div>

      <SectionCard className="mt-6 p-5 sm:p-6">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-indigo-600">
          How priority is decided
        </p>
        <h2 className="mt-2 font-bold text-slate-900">
          Web research first, then a 100-point score
        </h2>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {[
            ["Role", "25"],
            ["Company", "20"],
            ["Intent", "25"],
            ["Seniority", "15"],
            ["Engagement", "10"],
            ["Contactability", "5"],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-xl border border-slate-200 bg-slate-50/60 p-3"
            >
              <p className="text-xs font-semibold text-slate-500">{label}</p>
              <p className="mt-1 text-lg font-bold text-slate-900">{value}</p>
            </div>
          ))}
        </div>

        <p className="mt-4 text-sm leading-6 text-slate-500">
          Before scoring, the AI searches the professional public web, starting from
          the LinkedIn URL when available, to verify the current role, company and
          seniority. It then combines that with your RB2B website intent and engagement.
          80–100 is Strong target, 60–79 is Review, and 0–59 is Low priority. Human
          approval remains required before Clay or HeyReach outreach.
        </p>
      </SectionCard>

      <SectionCard className="mt-6 overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
          <h2 className="font-bold text-slate-900">Target queue</h2>
          <p className="mt-1 text-sm text-slate-500">
            Sorted from highest to lowest target score.
          </p>
        </div>

        {leads.length === 0 ? (
          <div className="px-6 py-14 text-center text-sm text-slate-500">
            No AI analyses yet. Open a person-level visitor and run “Analyse target”.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] table-fixed text-left text-sm">
              <thead className="bg-slate-50/80 text-[11px] uppercase tracking-[0.08em] text-slate-400">
                <tr>
                  <th className="w-[10%] px-6 py-4">Score</th>
                  <th className="w-[22%] px-4 py-4">Person</th>
                  <th className="w-[22%] px-4 py-4">Company</th>
                  <th className="w-[20%] px-4 py-4">Role</th>
                  <th className="w-[14%] px-4 py-4">Priority</th>
                  <th className="w-[12%] px-6 py-4" />
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {leads.map((lead) => {
                  const visitId = visitMap.get(lead.id);
                  const leadCompany = company(lead.companies);
                  const targetPriority = priority(lead.icp_score);

                  return (
                    <tr key={lead.id} className="hover:bg-indigo-50/20">
                      <td className="px-6 py-4 text-xl font-bold text-slate-900">
                        {lead.icp_score}
                      </td>

                      <td className="px-4 py-4">
                        {lead.linkedin_url ? (
                          <a
                            href={lead.linkedin_url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-semibold text-slate-900 transition hover:text-indigo-600"
                          >
                            {name(lead)} ↗
                          </a>
                        ) : (
                          <span className="font-semibold text-slate-900">
                            {name(lead)}
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-4 text-slate-600">
                        {leadCompany?.linkedin_url ? (
                          <a
                            href={leadCompany.linkedin_url}
                            target="_blank"
                            rel="noreferrer"
                            className="transition hover:text-indigo-600"
                          >
                            {leadCompany.name} ↗
                          </a>
                        ) : (
                          leadCompany?.name ?? "—"
                        )}
                      </td>

                      <td className="px-4 py-4 text-slate-600">
                        <span className="line-clamp-2">
                          {lead.job_title ?? "—"}
                        </span>
                      </td>

                      <td className="px-4 py-4">
                        <StatusPill tone={targetPriority.tone}>
                          {targetPriority.label}
                        </StatusPill>
                      </td>

                      <td className="px-6 py-4 text-right">
                        {visitId ? (
                          <Link
                            href={`/visitors/${visitId}`}
                            className="text-sm font-semibold text-indigo-600"
                          >
                            Open →
                          </Link>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </AppShell>
  );
}
