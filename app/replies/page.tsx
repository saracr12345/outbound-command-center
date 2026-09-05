import { AppShell } from "@/app/components/app-shell";
import { SectionCard, StatusPill } from "@/app/components/ui";
import { getDashboardContext } from "@/lib/dashboard/context";

type LeadRow = { id: string; first_name: string | null; last_name: string | null; job_title: string | null; status: string };

export default async function RepliesPage() {
  const { supabase, organizationId, organizationName, email, role } = await getDashboardContext();
  const { data } = await supabase.from("leads").select("id, first_name, last_name, job_title, status").eq("organization_id", organizationId).in("status", ["replied", "interested"]).order("updated_at", { ascending: false }).limit(100);
  const leads = (data ?? []) as LeadRow[];
  return (
    <AppShell active="replies" organizationName={organizationName} email={email} role={role} title="Replies" description="This will become one inbox for Clay email replies and HeyReach LinkedIn replies.">
      <SectionCard className="overflow-hidden"><div className="border-b border-slate-100 px-5 py-5 sm:px-6"><h2 className="font-bold text-slate-900">Reply queue</h2><p className="mt-1 text-sm text-slate-500">Current records marked as replied or interested.</p></div>{leads.length ? <div className="divide-y divide-slate-100">{leads.map((lead) => <div key={lead.id} className="flex items-center gap-4 px-5 py-5 sm:px-6"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-sm font-bold text-emerald-700">{(lead.first_name ?? "?").slice(0,1).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="font-semibold text-slate-900">{[lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Unnamed lead"}</p><p className="mt-1 text-sm text-slate-500">{lead.job_title ?? "Role unknown"}</p></div><StatusPill tone="green">{lead.status === "interested" ? "Interested" : "Replied"}</StatusPill></div>)}</div> : <div className="px-6 py-14 text-center"><p className="font-semibold text-slate-700">No synced replies yet</p><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">After HeyReach and Clay webhooks are connected, the actual reply content and channel will appear here.</p></div>}</SectionCard>
    </AppShell>
  );
}
