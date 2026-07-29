import Link from "next/link";
import { redirect } from "next/navigation";
import { logout } from "@/app/dashboard/actions";
import { createClient } from "@/lib/supabase/server";
import {
  buildVisitorViewModel,
  formatDateTime,
  formatLabel,
  visitorSearchText,
  type WebsiteVisitRow,
} from "@/lib/visitors/presentation";

type VisitorsPageProps = {
  searchParams: Promise<{
    type?: string;
    q?: string;
  }>;
};

function filterHref(type: "all" | "person" | "company", query: string) {
  const params = new URLSearchParams();

  if (type !== "all") params.set("type", type);
  if (query) params.set("q", query);

  const suffix = params.toString();
  return suffix ? `/visitors?${suffix}` : "/visitors";
}

export default async function VisitorsPage({
  searchParams,
}: VisitorsPageProps) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const userId = typeof claims?.sub === "string" ? claims.sub : null;

  if (!userId) redirect("/login");

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (membershipError || !membership) {
    redirect("/dashboard?error=Your%20team%20membership%20could%20not%20be%20loaded.");
  }

  const organizationId = membership.organization_id as string;
  const email =
    typeof claims?.email === "string" ? claims.email : "Team member";
  const params = await searchParams;
  const selectedType =
    params.type === "person" || params.type === "company"
      ? params.type
      : "all";
  const query = String(params.q ?? "").trim().toLowerCase();

  const [organizationResult, visitsResult] = await Promise.all([
    supabase
      .from("organizations")
      .select("name")
      .eq("id", organizationId)
      .single(),
    supabase
      .from("website_visits")
      .select(
        `
          id,
          organization_id,
          company_id,
          lead_id,
          source,
          page_url,
          page_title,
          referrer_url,
          visitor_id,
          occurred_at,
          payload,
          companies (
            id,
            name,
            domain,
            website_url,
            linkedin_url,
            industry,
            employee_count,
            country,
            metadata
          ),
          leads (
            id,
            first_name,
            last_name,
            job_title,
            email,
            phone,
            linkedin_url,
            status,
            icp_score,
            metadata
          )
        `,
      )
      .eq("organization_id", organizationId)
      .order("occurred_at", { ascending: false })
      .limit(500),
  ]);

  if (visitsResult.error) {
    console.error("Could not load website visitors:", visitsResult.error);
  }

  const visits = (visitsResult.data ?? []) as WebsiteVisitRow[];
  const rows = visits.map((visit) => ({
    visit,
    model: buildVisitorViewModel(visit),
  }));

  const personCount = rows.filter(
    ({ model }) => model.profileType === "person",
  ).length;
  const companyCount = rows.filter(
    ({ model }) => model.profileType === "company",
  ).length;

  const filteredRows = rows.filter(({ model }) => {
    if (selectedType !== "all" && model.profileType !== selectedType) {
      return false;
    }

    if (query && !visitorSearchText(model).includes(query)) return false;
    return true;
  });

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
            <h1 className="mt-1 text-xl font-bold">Website visitors</h1>
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
        <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <Link
              href="/dashboard"
              className="text-sm font-semibold text-indigo-600 hover:text-indigo-700"
            >
              ← Back to dashboard
            </Link>
            <h2 className="mt-4 text-3xl font-bold tracking-tight">
              Visitor activity
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-500">
              Review every person-level and company-level visit captured through
              RB2B and Slack.
            </p>
          </div>

          <form method="get" className="flex w-full max-w-md gap-2">
            {selectedType !== "all" ? (
              <input type="hidden" name="type" value={selectedType} />
            ) : null}
            <input
              name="q"
              type="search"
              defaultValue={params.q ?? ""}
              placeholder="Search person, company or page"
              className="min-w-0 flex-1 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
            />
            <button className="rounded-xl bg-neutral-950 px-5 py-3 text-sm font-semibold text-white hover:bg-neutral-800">
              Search
            </button>
          </form>
        </div>

        <section className="grid gap-4 md:grid-cols-3">
          {[
            { label: "All visit events", value: rows.length, type: "all" as const },
            { label: "Person-level visits", value: personCount, type: "person" as const },
            { label: "Company-level visits", value: companyCount, type: "company" as const },
          ].map((item) => {
            const active = selectedType === item.type;

            return (
              <Link
                key={item.type}
                href={filterHref(item.type, params.q ?? "")}
                className={
                  active
                    ? "rounded-2xl border border-indigo-200 bg-indigo-50 p-6 shadow-sm transition hover:-translate-y-0.5"
                    : "rounded-2xl border border-black/5 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                }
              >
                <p className="text-sm font-medium text-neutral-500">
                  {item.label}
                </p>
                <p className="mt-5 text-4xl font-bold tracking-tight">
                  {item.value}
                </p>
              </Link>
            );
          })}
        </section>

        <section className="mt-8 overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
          <div className="flex flex-col justify-between gap-3 border-b border-neutral-100 px-6 py-5 sm:flex-row sm:items-center">
            <div>
              <h3 className="font-bold">Captured visits</h3>
              <p className="mt-1 text-sm text-neutral-500">
                {filteredRows.length} result{filteredRows.length === 1 ? "" : "s"}
                {query ? ` matching “${params.q}”` : ""}.
              </p>
            </div>
            {(query || selectedType !== "all") && (
              <Link
                href="/visitors"
                className="text-sm font-semibold text-indigo-600 hover:text-indigo-700"
              >
                Clear filters
              </Link>
            )}
          </div>

          {filteredRows.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <p className="font-semibold">No visitor records found</p>
              <p className="mt-2 text-sm text-neutral-500">
                Try clearing the filters or wait for the next RB2B alert.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-left text-sm">
                <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-400">
                  <tr>
                    <th className="px-6 py-4 font-semibold">Visitor</th>
                    <th className="px-4 py-4 font-semibold">Type</th>
                    <th className="px-4 py-4 font-semibold">Company</th>
                    <th className="px-4 py-4 font-semibold">Location</th>
                    <th className="px-4 py-4 font-semibold">Page viewed</th>
                    <th className="px-4 py-4 font-semibold">Visit time</th>
                    <th className="px-6 py-4 font-semibold">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filteredRows.map(({ visit, model }) => (
                    <tr key={visit.id} className="hover:bg-neutral-50/70">
                      <td className="px-6 py-4">
                        <p className="font-semibold">{model.displayName}</p>
                        <p className="mt-1 text-xs text-neutral-500">
                          {model.profileType === "person"
                            ? model.jobTitle ?? model.maskedEmail ?? "Person profile"
                            : model.industry ?? model.companyDomain ?? "Company profile"}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <span
                          className={
                            model.profileType === "person"
                              ? "rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700"
                              : "rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700"
                          }
                        >
                          {model.profileType === "person" ? "Person" : "Company"}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-neutral-600">
                        {model.companyName}
                      </td>
                      <td className="px-4 py-4 text-neutral-600">
                        {model.location ?? "—"}
                      </td>
                      <td className="max-w-[280px] px-4 py-4">
                        {model.pageUrl ? (
                          <a
                            href={model.pageUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="block truncate font-medium text-indigo-600 hover:text-indigo-700"
                          >
                            {model.pageTitle ?? model.pageUrl}
                          </a>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-neutral-500">
                        {formatDateTime(model.occurredAt)}
                      </td>
                      <td className="px-6 py-4">
                        <Link
                          href={`/visitors/${visit.id}`}
                          className="rounded-lg border border-neutral-200 px-3 py-2 text-xs font-semibold hover:bg-neutral-50"
                        >
                          View details
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
