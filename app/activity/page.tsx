import { AppShell } from "@/app/components/app-shell";
import { SectionCard } from "@/app/components/ui";
import { getDashboardContext } from "@/lib/dashboard/context";
import { formatDateTime } from "@/lib/visitors/presentation";

type ActivityRow = { id: string; title: string; description: string | null; occurred_at: string };

export default async function ActivityPage() {
  const { supabase, organizationId, organizationName, email, role } = await getDashboardContext();
  const { data } = await supabase.from("activities").select("id, title, description, occurred_at").eq("organization_id", organizationId).order("occurred_at", { ascending: false }).limit(250);
  const activities = (data ?? []) as ActivityRow[];
  return <AppShell active="activity" organizationName={organizationName} email={email} role={role} title="Activity" description="A chronological record of visitor ingestion, AI analysis, outreach approvals and future campaign events."><SectionCard className="overflow-hidden"><div className="border-b border-slate-100 px-5 py-5 sm:px-6"><h2 className="font-bold text-slate-900">Workflow timeline</h2></div><div className="px-5 py-2 sm:px-6">{activities.length ? activities.map((activity) => <div key={activity.id} className="relative border-l border-indigo-100 py-5 pl-6"><span className="absolute -left-[5px] top-6 h-2.5 w-2.5 rounded-full bg-indigo-300 ring-4 ring-indigo-50" /><p className="text-sm font-semibold text-slate-800">{activity.title}</p>{activity.description ? <p className="mt-1 text-sm leading-6 text-slate-500">{activity.description}</p> : null}<p className="mt-2 text-xs text-slate-400">{formatDateTime(activity.occurred_at)}</p></div>) : <div className="py-14 text-center text-sm text-slate-500">No activity recorded yet.</div>}</div></SectionCard></AppShell>;
}
