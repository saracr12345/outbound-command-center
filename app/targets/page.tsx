import Link from "next/link";
import { AppShell } from "@/app/components/app-shell";
import { MetricCard, SectionCard, StatusPill, scoreLabel, scoreTone } from "@/app/components/ui";
import { getDashboardContext } from "@/lib/dashboard/context";

type CompanyRelation = { name: string; domain: string | null };
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
type VisitRow = { id: string; lead_id: string | null; occurred_at: string };

function companyName(value: LeadRow["companies"]) {
  return Array.isArray(value) ? value[0]?.name ?? "—" : value?.name ?? "—";
}
function name(lead: LeadRow) {
  return [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim() || "Unnamed person";
}

export default async function TargetsPage() {
  const { supabase, organizationId, organizationName, email, role } = await getDashboardContext();
  const { data } = await supabase
    .from("leads")
    .select("id, first_name, last_name, job_title, linkedin_url, status, icp_score, companies (name, domain)")
    .eq("organization_id", organizationId)
    .not("icp_score", "is", null)
    .order("icp_score", { ascending: false })
    .limit(250);

  const leads = (data ?? []) as LeadRow[];
  const strong = leads.filter((lead) => (lead.icp_score ?? 0) >= 80).length;
  const review = leads.filter((lead) => (lead.icp_score ?? 0) >= 60 && (lead.icp_score ?? 0) < 80).length;
  const low = leads.filter((lead) => (lead.icp_score ?? 0) < 60).length;

  const visitMap = new Map<string, string>();
  if (leads.length) {
    const { data: visits } = await supabase
      .from("website_visits")
      .select("id, lead_id, occurred_at")
      .eq("organization_id", organizationId)
      .in("lead_id", leads.map((lead) => lead.id))
      .order("occurred_at", { ascending: false });
    for (const visit of (visits ?? []) as VisitRow[]) {
      if (visit.lead_id && !visitMap.has(visit.lead_id)) visitMap.set(visit.lead_id, visit.id);
    }
  }

  return (
    <AppShell active="targets" organizationName={organizationName} email={email} role={role} title="AI Targets" description="Prioritise person-level visitors using the AI score already generated from role, company fit, intent, seniority, engagement and contactability.">
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Strong targets" value={strong} note="80–100" tone="green" />
        <MetricCard label="Review" value={review} note="60–79" tone="amber" />
        <MetricCard label="Low priority" value={low} note="0–59" tone="indigo" />
      </div>

      <SectionCard className="mt-6 overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-5 sm:px-6"><h2 className="font-bold text-slate-900">Target queue</h2><p className="mt-1 text-sm text-slate-500">Sorted from highest to lowest score.</p></div>
        {leads.length === 0 ? <div className="px-6 py-14 text-center text-sm text-slate-500">No AI analyses yet. Open a person-level visitor and run “Analyse target”.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="bg-slate-50/80 text-[11px] uppercase tracking-[0.08em] text-slate-400"><tr><th className="px-6 py-4">Score</th><th className="px-4 py-4">Person</th><th className="px-4 py-4">Company</th><th className="px-4 py-4">Role</th><th className="px-4 py-4">LinkedIn</th><th className="px-4 py-4">Priority</th><th className="px-6 py-4" /></tr></thead>
              <tbody className="divide-y divide-slate-100">{leads.map((lead) => { const visitId = visitMap.get(lead.id); return <tr key={lead.id} className="hover:bg-indigo-50/20"><td className="px-6 py-4 text-xl font-bold text-slate-900">{lead.icp_score}</td><td className="px-4 py-4 font-semibold text-slate-900">{name(lead)}</td><td className="px-4 py-4 text-slate-600">{companyName(lead.companies)}</td><td className="px-4 py-4 text-slate-600">{lead.job_title ?? "—"}</td><td className="px-4 py-4">{lead.linkedin_url ? <StatusPill tone="indigo">Available</StatusPill> : <StatusPill>Missing</StatusPill>}</td><td className="px-4 py-4"><StatusPill tone={scoreTone(lead.icp_score)}>{scoreLabel(lead.icp_score)}</StatusPill></td><td className="px-6 py-4 text-right">{visitId ? <Link href={`/visitors/${visitId}`} className="text-sm font-semibold text-indigo-600">Open →</Link> : <span className="text-slate-300">—</span>}</td></tr>; })}</tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </AppShell>
  );
}
