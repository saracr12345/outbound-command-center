import Link from "next/link";
import { AppShell } from "@/app/components/app-shell";
import { MetricCard, SectionCard, StatusPill, scoreLabel, scoreTone } from "@/app/components/ui";
import { getDashboardContext } from "@/lib/dashboard/context";
import { formatDateTime, formatLabel } from "@/lib/visitors/presentation";

type DashboardPageProps = {
  searchParams: Promise<{ error?: string; success?: string }>;
};

type CompanyRelation = { name: string; domain: string | null };
type LeadRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  email: string | null;
  linkedin_url: string | null;
  status: string;
  icp_score: number | null;
  companies: CompanyRelation | CompanyRelation[] | null;
};

type VisitRow = { id: string; lead_id: string | null; occurred_at: string };
type ActivityRow = { id: string; title: string; occurred_at: string };

function firstCompany(relation: LeadRow["companies"]) {
  return Array.isArray(relation) ? relation[0] ?? null : relation;
}

function fullName(lead: LeadRow) {
  return [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim() || lead.email || "Unnamed lead";
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const { supabase, organizationId, organizationName, email, role } = await getDashboardContext();
  const messages = await searchParams;

  const [
    visitsCount,
    strongCount,
    approvedCount,
    draftCount,
    replyCount,
    highIntentResult,
    activitiesResult,
  ] = await Promise.all([
    supabase.from("website_visits").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).gte("icp_score", 80),
    supabase.from("outreach_drafts").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("status", "approved"),
    supabase.from("outreach_drafts").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("status", "draft"),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).in("status", ["replied", "interested"]),
    supabase
      .from("leads")
      .select(`id, first_name, last_name, job_title, email, linkedin_url, status, icp_score, companies (name, domain)`)
      .eq("organization_id", organizationId)
      .not("icp_score", "is", null)
      .order("icp_score", { ascending: false })
      .limit(6),
    supabase
      .from("activities")
      .select("id, title, occurred_at")
      .eq("organization_id", organizationId)
      .order("occurred_at", { ascending: false })
      .limit(7),
  ]);

  const leads = (highIntentResult.data ?? []) as LeadRow[];
  const leadIds = leads.map((lead) => lead.id);
  const visitMap = new Map<string, string>();

  if (leadIds.length) {
    const { data: visits } = await supabase
      .from("website_visits")
      .select("id, lead_id, occurred_at")
      .eq("organization_id", organizationId)
      .in("lead_id", leadIds)
      .order("occurred_at", { ascending: false });

    for (const visit of (visits ?? []) as VisitRow[]) {
      if (visit.lead_id && !visitMap.has(visit.lead_id)) visitMap.set(visit.lead_id, visit.id);
    }
  }

  const activities = (activitiesResult.data ?? []) as ActivityRow[];

  return (
    <AppShell
      active="overview"
      organizationName={organizationName}
      email={email}
      role={role}
      title="Overview"
      description="From website visitor to qualified target, personalised outreach and campaign launch — all in one place."
      actions={
        <Link href="/visitors" className="inline-flex rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700">
          Review visitors
        </Link>
      }
    >
      {messages.error ? <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{messages.error}</div> : null}
      {messages.success ? <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{messages.success}</div> : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Website visitors" value={visitsCount.count ?? 0} note="RB2B" href="/visitors" tone="blue" />
        <MetricCard label="Strong targets" value={strongCount.count ?? 0} note="AI score 80+" href="/targets" tone="green" />
        <MetricCard label="Approved outreach" value={approvedCount.count ?? 0} note={`${draftCount.count ?? 0} drafts`} href="/outreach" tone="indigo" />
        <MetricCard label="Replies" value={replyCount.count ?? 0} note="Email + LinkedIn" href="/replies" tone="amber" />
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.45fr_0.8fr]">
        <SectionCard>
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-5 sm:px-6">
            <div>
              <h2 className="font-bold text-slate-900">High-intent prospects</h2>
              <p className="mt-1 text-sm text-slate-500">Highest AI-scored people currently in the database.</p>
            </div>
            <Link href="/targets" className="text-sm font-semibold text-indigo-600 hover:text-indigo-700">View all →</Link>
          </div>

          {leads.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-slate-500">Analyse a person-level visitor and strong targets will appear here.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {leads.map((lead) => {
                const visitId = visitMap.get(lead.id);
                const company = firstCompany(lead.companies);
                const row = (
                  <div className="flex items-center gap-4 px-5 py-4 sm:px-6">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-sm font-bold text-indigo-700">
                      {fullName(lead).slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{fullName(lead)}</p>
                      <p className="mt-1 truncate text-xs text-slate-500">{[lead.job_title, company?.name].filter(Boolean).join(" · ") || "Profile details pending"}</p>
                    </div>
                    <div className="hidden sm:block"><StatusPill tone={scoreTone(lead.icp_score)}>{scoreLabel(lead.icp_score)}</StatusPill></div>
                    <div className="w-14 text-right text-lg font-bold text-slate-900">{lead.icp_score ?? "—"}</div>
                  </div>
                );
                return visitId ? <Link key={lead.id} href={`/visitors/${visitId}`} className="block transition hover:bg-slate-50/70">{row}</Link> : <div key={lead.id}>{row}</div>;
              })}
            </div>
          )}
        </SectionCard>

        <SectionCard>
          <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
            <h2 className="font-bold text-slate-900">Recent activity</h2>
            <p className="mt-1 text-sm text-slate-500">Live workflow events from Supabase.</p>
          </div>
          <div className="px-5 py-2 sm:px-6">
            {activities.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-500">Activity will appear as visitors and outreach move through the flow.</p>
            ) : (
              activities.map((activity) => (
                <div key={activity.id} className="relative border-l border-indigo-100 py-4 pl-5 first:pt-5 last:pb-5">
                  <span className="absolute -left-[5px] top-[21px] h-2.5 w-2.5 rounded-full bg-indigo-300 ring-4 ring-indigo-50" />
                  <p className="text-sm font-medium text-slate-700">{activity.title}</p>
                  <p className="mt-1 text-xs text-slate-400">{formatDateTime(activity.occurred_at)}</p>
                </div>
              ))
            )}
          </div>
          <div className="border-t border-slate-100 px-6 py-4"><Link href="/activity" className="text-sm font-semibold text-indigo-600">Open full activity →</Link></div>
        </SectionCard>
      </div>

      <section className="mt-6 grid gap-4 md:grid-cols-3">
        {[
          { title: "1. Identify", text: "RB2B identifies people and companies visiting the website.", href: "/visitors", label: "Visitors" },
          { title: "2. Qualify + personalise", text: "AI scores person-level visitors and creates editable Email + LinkedIn drafts.", href: "/targets", label: "AI Targets" },
          { title: "3. Approve + launch", text: "Approved copy will route to HeyReach for LinkedIn and Clay for email.", href: "/outreach", label: "Outreach" },
        ].map((step) => (
          <Link key={step.title} href={step.href} className="rounded-2xl border border-slate-200/80 bg-white p-5 transition hover:border-indigo-200 hover:shadow-sm">
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-indigo-600">{step.label}</span>
            <h3 className="mt-3 font-bold text-slate-900">{step.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">{step.text}</p>
          </Link>
        ))}
      </section>
    </AppShell>
  );
}
