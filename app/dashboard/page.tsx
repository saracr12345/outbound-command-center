import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { addLead, logout } from "./actions";

type DashboardPageProps = {
  searchParams: Promise<{
    error?: string;
    success?: string;
  }>;
};

type CompanyRelation = {
  name: string;
  domain: string | null;
};

type LeadRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  job_title: string | null;
  source: string;
  status: string;
  icp_score: number | null;
  created_at: string;
  companies: CompanyRelation | CompanyRelation[] | null;
};

type IntegrationRow = {
  provider: string;
  status: string;
  last_synced_at: string | null;
};

function formatLabel(value: string) {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function companyName(
  relation: LeadRow["companies"],
): string {
  if (Array.isArray(relation)) {
    return relation[0]?.name ?? "—";
  }

  return relation?.name ?? "—";
}

const integrationDetails: Record<
  string,
  { name: string; description: string }
> = {
  rb2b: {
    name: "RB2B",
    description: "Website visitor identification",
  },
  clay: {
    name: "Clay",
    description: "Lead enrichment and qualification",
  },
  apify: {
    name: "Apify",
    description: "Automated research and scraping",
  },
  heyreach: {
    name: "HeyReach",
    description: "LinkedIn campaigns and replies",
  },
};

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const userId =
    typeof claims?.sub === "string" ? claims.sub : null;

  if (!userId) {
    redirect("/login");
  }

  const email =
  typeof claims?.email === "string"
    ? claims.email
    : "Team member";

  const { data: membership, error: membershipError } =
    await supabase
      .from("organization_members")
      .select("organization_id, role")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

  const messages = await searchParams;

  if (membershipError || !membership) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <section className="max-w-lg rounded-3xl border border-red-200 bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold text-red-600">
            Organization setup incomplete
          </p>
          <h1 className="mt-2 text-2xl font-bold">
            Your account has no team membership.
          </h1>
          <p className="mt-3 text-sm leading-6 text-neutral-500">
            Run the Milestone 2 SQL script in Supabase and make sure
            the bootstrap email exactly matches your authentication
            email.
          </p>
          <form action={logout} className="mt-6">
            <button className="rounded-xl bg-neutral-950 px-4 py-2 text-sm font-semibold text-white">
              Log out
            </button>
          </form>
        </section>
      </main>
    );
  }

  const organizationId = membership.organization_id as string;

  const [
    organizationResult,
    leadsResult,
    integrationsResult,
    leadsCountResult,
    visitsCountResult,
    activitiesResult,
  ] = await Promise.all([
    supabase
      .from("organizations")
      .select("name")
      .eq("id", organizationId)
      .single(),
    supabase
      .from("leads")
      .select(
        `
          id,
          first_name,
          last_name,
          email,
          job_title,
          source,
          status,
          icp_score,
          created_at,
          companies (
            name,
            domain
          )
        `,
      )
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("integration_connections")
      .select("provider, status, last_synced_at")
      .eq("organization_id", organizationId)
      .order("provider"),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId),
    supabase
      .from("website_visits")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId),
    supabase
      .from("activities")
      .select("id, title, occurred_at")
      .eq("organization_id", organizationId)
      .order("occurred_at", { ascending: false })
      .limit(5),
  ]);

  if (leadsResult.error) {
    console.error("Could not load leads:", leadsResult.error);
  }

  const leads = (leadsResult.data ?? []) as LeadRow[];
  const integrations =
    (integrationsResult.data ?? []) as IntegrationRow[];
  const recentActivities = activitiesResult.data ?? [];

  const enrichedCount = leads.filter(
    (lead) =>
      lead.status === "enriched" ||
      lead.status === "qualified" ||
      lead.status === "approved" ||
      lead.status === "campaign_active" ||
      lead.status === "replied" ||
      lead.status === "interested",
  ).length;

  const activeCampaignCount = leads.filter(
    (lead) => lead.status === "campaign_active",
  ).length;

  const metrics = [
    {
      label: "Website visitors",
      value: visitsCountResult.count ?? 0,
      note: "RB2B",
    },
    {
      label: "Total leads",
      value: leadsCountResult.count ?? 0,
      note: "Database",
    },
    {
      label: "Enriched leads",
      value: enrichedCount,
      note: "Clay",
    },
    {
      label: "Active campaigns",
      value: activeCampaignCount,
      note: "HeyReach",
    },
  ];

  const organizationName =
    organizationResult.data?.name ?? "Outbound Command Center";

  return (
    <div className="min-h-screen bg-[#f6f7fb]">
      <header className="border-b border-black/5 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">
              {organizationName}
            </p>
            <h1 className="mt-1 text-xl font-bold">
              Outbound Command Center
            </h1>
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

        <section className="mb-10">
          <p className="text-sm text-neutral-500">Overview</p>
          <h2 className="mt-1 text-3xl font-bold tracking-tight">
            Live outbound database.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-500">
            Leads are now stored and protected in Supabase.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <article
              key={metric.label}
              className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm"
            >
              <div className="flex items-start justify-between">
                <p className="text-sm font-medium text-neutral-500">
                  {metric.label}
                </p>
                <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-500">
                  {metric.note}
                </span>
              </div>
              <p className="mt-6 text-4xl font-bold tracking-tight">
                {metric.value}
              </p>
            </article>
          ))}
        </section>

        <section className="mt-8 grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
          <article className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-neutral-100 px-6 py-5">
              <div>
                <h3 className="font-bold">Recent leads</h3>
                <p className="mt-1 text-sm text-neutral-500">
                  The 25 newest leads in organisation.
                </p>
              </div>
              <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
                {leads.length} shown
              </span>
            </div>

            {leads.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <p className="font-semibold">No leads yet</p>
                <p className="mt-2 text-sm text-neutral-500">
                  Add the first test lead using the form.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-400">
                    <tr>
                      <th className="px-6 py-4 font-semibold">Lead</th>
                      <th className="px-4 py-4 font-semibold">Company</th>
                      <th className="px-4 py-4 font-semibold">Source</th>
                      <th className="px-4 py-4 font-semibold">Status</th>
                      <th className="px-4 py-4 font-semibold">Score</th>
                      <th className="px-6 py-4 font-semibold">Added</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {leads.map((lead) => {
                      const fullName =
                        [lead.first_name, lead.last_name]
                          .filter(Boolean)
                          .join(" ") ||
                        lead.email ||
                        "Unnamed lead";

                      return (
                        <tr key={lead.id} className="hover:bg-neutral-50/60">
                          <td className="px-6 py-4">
                            <p className="font-semibold">{fullName}</p>
                            <p className="mt-1 text-xs text-neutral-500">
                              {lead.job_title || lead.email || "—"}
                            </p>
                          </td>
                          <td className="px-4 py-4 text-neutral-600">
                            {companyName(lead.companies)}
                          </td>
                          <td className="px-4 py-4">
                            <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600">
                              {formatLabel(lead.source)}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                              {formatLabel(lead.status)}
                            </span>
                          </td>
                          <td className="px-4 py-4 font-semibold">
                            {lead.icp_score ?? "—"}
                          </td>
                          <td className="px-6 py-4 text-neutral-500">
                            {new Intl.DateTimeFormat("en-GB", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            }).format(new Date(lead.created_at))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          <div className="space-y-6">
            <article className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
              <h3 className="font-bold">Add a test lead</h3>
              <p className="mt-1 text-sm text-neutral-500">
                This verifies insert permissions and live database reads.
              </p>

              <form action={addLead} className="mt-6 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="firstName"
                      className="mb-1.5 block text-xs font-semibold text-neutral-600"
                    >
                      First name
                    </label>
                    <input
                      id="firstName"
                      name="firstName"
                      className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                      placeholder="Jane"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="lastName"
                      className="mb-1.5 block text-xs font-semibold text-neutral-600"
                    >
                      Last name
                    </label>
                    <input
                      id="lastName"
                      name="lastName"
                      className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                      placeholder="Smith"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="companyName"
                    className="mb-1.5 block text-xs font-semibold text-neutral-600"
                  >
                    Company
                  </label>
                  <input
                    id="companyName"
                    name="companyName"
                    className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                    placeholder="Acme Ltd"
                  />
                </div>

                <div>
                  <label
                    htmlFor="jobTitle"
                    className="mb-1.5 block text-xs font-semibold text-neutral-600"
                  >
                    Job title
                  </label>
                  <input
                    id="jobTitle"
                    name="jobTitle"
                    className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                    placeholder="Chief Technology Officer"
                  />
                </div>

                <div>
                  <label
                    htmlFor="email"
                    className="mb-1.5 block text-xs font-semibold text-neutral-600"
                  >
                    Email
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                    placeholder="jane@acme.com"
                  />
                </div>

                <div>
                  <label
                    htmlFor="linkedinUrl"
                    className="mb-1.5 block text-xs font-semibold text-neutral-600"
                  >
                    LinkedIn URL
                  </label>
                  <input
                    id="linkedinUrl"
                    name="linkedinUrl"
                    type="url"
                    className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                    placeholder="https://linkedin.com/in/..."
                  />
                </div>

                <button
                  type="submit"
                  className="w-full rounded-xl bg-neutral-950 px-4 py-3 text-sm font-semibold text-white hover:bg-neutral-800"
                >
                  Add lead
                </button>
              </form>
            </article>

            <article className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
              <h3 className="font-bold">Integrations</h3>
              <p className="mt-1 text-sm text-neutral-500">
                Connection status stored in Supabase.
              </p>

              <div className="mt-5 space-y-3">
                {integrations.map((integration) => {
                  const detail =
                    integrationDetails[integration.provider] ?? {
                      name: formatLabel(integration.provider),
                      description: "External integration",
                    };

                  const connected =
                    integration.status === "connected";

                  return (
                    <div
                      key={integration.provider}
                      className="flex items-center justify-between rounded-xl border border-neutral-100 px-4 py-4"
                    >
                      <div>
                        <p className="font-semibold">{detail.name}</p>
                        <p className="mt-1 text-xs text-neutral-500">
                          {detail.description}
                        </p>
                      </div>
                      <span
                        className={
                          connected
                            ? "rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"
                            : "rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700"
                        }
                      >
                        {formatLabel(integration.status)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </article>

            <article className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
              <h3 className="font-bold">Recent activity</h3>
              <div className="mt-5 space-y-4">
                {recentActivities.length === 0 ? (
                  <p className="text-sm text-neutral-500">
                    Activity appears after your first lead is added.
                  </p>
                ) : (
                  recentActivities.map((activity) => (
                    <div
                      key={activity.id}
                      className="border-l-2 border-indigo-200 pl-4"
                    >
                      <p className="text-sm font-medium">
                        {activity.title}
                      </p>
                      <p className="mt-1 text-xs text-neutral-400">
                        {new Intl.DateTimeFormat("en-GB", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(new Date(activity.occurred_at))}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </article>
          </div>
        </section>
      </main>
    </div>
  );
}
