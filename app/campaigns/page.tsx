import { AppShell } from "@/app/components/app-shell";
import { SectionCard, StatusPill } from "@/app/components/ui";
import { getDashboardContext } from "@/lib/dashboard/context";

export default async function CampaignsPage() {
  const { organizationName, email, role } = await getDashboardContext();
  return (
    <AppShell active="campaigns" organizationName={organizationName} email={email} role={role} title="Campaigns" description="Clay email and HeyReach LinkedIn campaigns will live together here once the launch integrations are connected.">
      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.13em] text-indigo-600">LinkedIn</p><h2 className="mt-2 text-xl font-bold text-slate-900">HeyReach</h2><p className="mt-2 text-sm leading-6 text-slate-500">Next step: load campaigns through the HeyReach API and let approved prospects be launched from the dashboard.</p></div><StatusPill tone="amber">Integration next</StatusPill></div>
          <div className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4"><p className="text-sm font-semibold text-indigo-900">Planned flow</p><p className="mt-2 text-sm leading-6 text-indigo-800">Approved LinkedIn draft → select HeyReach campaign → launch lead → capture campaign events and replies back into Supabase.</p></div>
        </SectionCard>
        <SectionCard className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.13em] text-sky-600">Email</p><h2 className="mt-2 text-xl font-bold text-slate-900">Clay</h2><p className="mt-2 text-sm leading-6 text-slate-500">After HeyReach, approved email drafts will route into existing Clay campaigns and campaign events will return to the dashboard.</p></div><StatusPill tone="neutral">Not connected</StatusPill></div>
          <div className="mt-5 rounded-xl border border-sky-100 bg-sky-50/50 p-4"><p className="text-sm font-semibold text-sky-900">Planned flow</p><p className="mt-2 text-sm leading-6 text-sky-800">Approved email → select Clay campaign → validate email → launch → receive send, bounce and reply events.</p></div>
        </SectionCard>
      </div>
      <SectionCard className="mt-6 p-5 sm:p-6"><h2 className="font-bold text-slate-900">Unified campaign view</h2><p className="mt-2 text-sm leading-6 text-slate-500">Once both integrations are live, this page will show campaign name, platform, status, leads, sent messages, replies, reply rate and recent activity without making you switch between Clay and HeyReach.</p></SectionCard>
    </AppShell>
  );
}
