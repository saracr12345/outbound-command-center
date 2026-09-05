import { AppShell } from "@/app/components/app-shell";
import { SectionCard, StatusPill } from "@/app/components/ui";
import { getDashboardContext } from "@/lib/dashboard/context";
import { formatDateTime, formatLabel } from "@/lib/visitors/presentation";

type IntegrationRow = { provider: string; status: string; last_synced_at: string | null };

export default async function IntegrationsPage() {
  const { supabase, organizationId, organizationName, email, role } = await getDashboardContext();
  const { data } = await supabase.from("integration_connections").select("provider, status, last_synced_at").eq("organization_id", organizationId).order("provider");
  const stored = new Map(((data ?? []) as IntegrationRow[]).map((item) => [item.provider, item]));
  const cards = [
    { key: "rb2b", name: "RB2B", description: "Website visitor identification", configured: Boolean(process.env.RB2B_ORGANIZATION_ID) },
    { key: "slack", name: "Slack", description: "RB2B event transport into the app", configured: Boolean(process.env.SLACK_SIGNING_SECRET) },
    { key: "openai", name: "OpenAI", description: "AI target scoring and personalised copy", configured: Boolean(process.env.OPENAI_API_KEY) },
    { key: "heyreach", name: "HeyReach", description: "LinkedIn campaign execution", configured: Boolean(process.env.HEYREACH_API_KEY) },
    { key: "clay", name: "Clay", description: "Email campaign execution", configured: false },
    { key: "supabase", name: "Supabase", description: "Authentication and central database", configured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY) },
  ];

  return (
    <AppShell active="integrations" organizationName={organizationName} email={email} role={role} title="Integrations" description="Connection health and readiness for the systems behind the outbound workflow.">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{cards.map((card) => { const record = stored.get(card.key); const connected = record?.status === "connected" || card.configured; return <SectionCard key={card.key} className="p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-bold text-slate-900">{card.name}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{card.description}</p></div><StatusPill tone={connected ? "green" : card.key === "clay" ? "neutral" : "amber"}>{connected ? "Connected" : card.key === "clay" ? "Not connected" : "Needs setup"}</StatusPill></div><div className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-400">{record?.last_synced_at ? `Last sync ${formatDateTime(record.last_synced_at)}` : record ? `Status: ${formatLabel(record.status)}` : "No sync record yet"}</div></SectionCard>; })}</div>
    </AppShell>
  );
}
