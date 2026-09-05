import Link from "next/link";
import { AppShell } from "@/app/components/app-shell";
import { MetricCard, SectionCard, StatusPill } from "@/app/components/ui";
import { getDashboardContext } from "@/lib/dashboard/context";
import { formatDateTime, formatLabel } from "@/lib/visitors/presentation";

type LeadRelation = { first_name: string | null; last_name: string | null; job_title: string | null };
type DraftRow = {
  id: string;
  visit_id: string | null;
  status: string;
  email_subject: string;
  created_at: string;
  approved_at: string | null;
  leads: LeadRelation | LeadRelation[] | null;
};
function firstLead(value: DraftRow["leads"]) { return Array.isArray(value) ? value[0] ?? null : value; }

export default async function OutreachPage() {
  const { supabase, organizationId, organizationName, email, role } = await getDashboardContext();
  const { data } = await supabase
    .from("outreach_drafts")
    .select("id, visit_id, status, email_subject, created_at, approved_at, leads (first_name, last_name, job_title)")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false })
    .limit(250);

  const drafts = (data ?? []) as DraftRow[];
  const draftCount = drafts.filter((item) => item.status === "draft").length;
  const approvedCount = drafts.filter((item) => item.status === "approved").length;
  const launchedCount = drafts.filter((item) => item.status === "launched").length;

  return (
    <AppShell active="outreach" organizationName={organizationName} email={email} role={role} title="Outreach" description="Review AI-generated email and LinkedIn copy, approve it, and prepare it for Clay and HeyReach launch.">
      <div className="grid gap-4 sm:grid-cols-3"><MetricCard label="Drafts" value={draftCount} note="Needs review" tone="amber" /><MetricCard label="Approved" value={approvedCount} note="Ready to launch" tone="green" /><MetricCard label="Launched" value={launchedCount} note="Future sync" tone="indigo" /></div>
      <SectionCard className="mt-6 overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-5 sm:px-6"><h2 className="font-bold text-slate-900">Outreach queue</h2><p className="mt-1 text-sm text-slate-500">Latest drafts first.</p></div>
        {drafts.length === 0 ? <div className="px-6 py-14 text-center text-sm text-slate-500">No outreach drafts yet. Generate one from a visitor profile.</div> : <div className="divide-y divide-slate-100">{drafts.map((draft) => { const lead = firstLead(draft.leads); const person = [lead?.first_name, lead?.last_name].filter(Boolean).join(" ") || "Unnamed person"; const tone = draft.status === "approved" ? "green" : draft.status === "launched" ? "indigo" : "amber"; return <div key={draft.id} className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:px-6"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-slate-900">{person}</p><StatusPill tone={tone}>{formatLabel(draft.status)}</StatusPill></div><p className="mt-1 truncate text-sm text-slate-500">{lead?.job_title ?? "Role unknown"} · {draft.email_subject}</p><p className="mt-2 text-xs text-slate-400">Created {formatDateTime(draft.created_at)}{draft.approved_at ? ` · approved ${formatDateTime(draft.approved_at)}` : ""}</p></div>{draft.visit_id ? <Link href={`/visitors/${draft.visit_id}`} className="shrink-0 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-indigo-600 hover:border-indigo-200">Review copy →</Link> : null}</div>; })}</div>}
      </SectionCard>
    </AppShell>
  );
}
