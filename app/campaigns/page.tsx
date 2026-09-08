import { AppShell } from "@/app/components/app-shell";
import { SectionCard, StatusPill } from "@/app/components/ui";
import { getDashboardContext } from "@/lib/dashboard/context";
import { listHeyReachCampaigns, type HeyReachCampaign } from "@/lib/heyreach/client";

function campaignTone(status: string | null | undefined) {
  const value = String(status ?? "").toUpperCase();
  if (["IN_PROGRESS", "ACTIVE", "ONGOING"].includes(value)) return "green" as const;
  if (value === "PAUSED") return "amber" as const;
  if (value === "FINISHED") return "neutral" as const;
  if (["FAILED", "CANCELED", "CANCELLED"].includes(value)) return "red" as const;
  return "indigo" as const;
}

function displayStatus(status: string | null | undefined) {
  return String(status ?? "Unknown").replaceAll("_", " ");
}

export default async function CampaignsPage() {
  const { organizationName, email, role } = await getDashboardContext();
  let campaigns: HeyReachCampaign[] = [];
  let heyReachError = "";

  if (process.env.HEYREACH_API_KEY) {
    try {
      const result = await listHeyReachCampaigns();
      campaigns = result.items;
    } catch (error) {
      heyReachError = error instanceof Error ? error.message : "Could not load HeyReach campaigns.";
    }
  }

  return (
    <AppShell active="campaigns" organizationName={organizationName} email={email} role={role} title="Campaigns" description="LinkedIn campaigns from HeyReach are live here now. Clay email campaigns will be added next.">
      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.13em] text-indigo-600">LinkedIn</p>
              <h2 className="mt-2 text-xl font-bold text-slate-900">HeyReach</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">Approved RB2B prospects can now be added to an existing active HeyReach campaign directly from their visitor profile.</p>
            </div>
            <StatusPill tone={process.env.HEYREACH_API_KEY && !heyReachError ? "green" : "amber"}>{process.env.HEYREACH_API_KEY && !heyReachError ? "Connected" : "Needs attention"}</StatusPill>
          </div>
        </SectionCard>

        <SectionCard className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.13em] text-sky-600">Email</p>
              <h2 className="mt-2 text-xl font-bold text-slate-900">Clay</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">We are deliberately leaving Clay untouched until HeyReach launch is verified. Then we will connect approved email copy to your existing Clay campaigns.</p>
            </div>
            <StatusPill tone="neutral">Next stage</StatusPill>
          </div>
        </SectionCard>
      </div>

      <SectionCard className="mt-6 overflow-hidden">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
          <div>
            <h2 className="font-bold text-slate-900">HeyReach campaigns</h2>
            <p className="mt-1 text-sm text-slate-500">Live data from your HeyReach workspace. Paused and finished campaigns are visible but blocked from dashboard launch to avoid accidental reactivation.</p>
          </div>
          <StatusPill tone="indigo">{campaigns.length} loaded</StatusPill>
        </div>

        {heyReachError ? (
          <div className="m-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 sm:m-6">{heyReachError}</div>
        ) : campaigns.length === 0 ? (
          <div className="px-6 py-14 text-center text-sm text-slate-500">No HeyReach campaigns could be loaded.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {campaigns.map((campaign) => {
              const stats = campaign.progressStats;
              return (
                <div key={campaign.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:px-6">
                  <div>
                    <p className="font-semibold text-slate-900">{campaign.name}</p>
                    <p className="mt-1 text-xs text-slate-400">Campaign ID {campaign.id}</p>
                  </div>
                  <div className="text-sm text-slate-500">
                    {typeof stats?.totalUsers === "number" ? `${stats.totalUsers} leads` : "Lead count unavailable"}
                  </div>
                  <StatusPill tone={campaignTone(campaign.status)}>{displayStatus(campaign.status)}</StatusPill>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </AppShell>
  );
}
