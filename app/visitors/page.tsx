import Link from "next/link";
import { AppShell } from "@/app/components/app-shell";
import { SectionCard, StatusPill } from "@/app/components/ui";
import { getDashboardContext } from "@/lib/dashboard/context";
import {
  buildVisitorViewModel,
  formatDateTime,
  visitorSearchText,
  type WebsiteVisitRow,
} from "@/lib/visitors/presentation";

type VisitorsPageProps = {
  searchParams: Promise<{ type?: string; q?: string }>;
};

type FilterType = "all" | "person" | "company";


function priorityForScore(score: number | null) {
  if (score === null) return null;
  if (score >= 80) return { label: "Strong target", tone: "green" as const };
  if (score >= 60) return { label: "Review", tone: "amber" as const };
  return { label: "Low priority", tone: "neutral" as const };
}

function filterHref(type: FilterType, query: string) {
  const params = new URLSearchParams();
  if (type !== "all") params.set("type", type);
  if (query) params.set("q", query);
  const suffix = params.toString();
  return suffix ? `/visitors?${suffix}` : "/visitors";
}

function ExternalName({
  href,
  children,
}: {
  href?: string | null;
  children: React.ReactNode;
}) {
  if (!href) return <span>{children}</span>;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-semibold text-slate-900 transition hover:text-indigo-600"
      title="Open LinkedIn"
    >
      {children}
      <span aria-hidden="true" className="text-[11px] text-indigo-400">
        ↗
      </span>
    </a>
  );
}

export default async function VisitorsPage({
  searchParams,
}: VisitorsPageProps) {
  const { supabase, organizationId, organizationName, email, role } =
    await getDashboardContext();
  const params = await searchParams;
  const selectedType: FilterType = ["person", "company"].includes(
    String(params.type),
  )
    ? (params.type as FilterType)
    : "all";
  const query = String(params.q ?? "").trim().toLowerCase();

  const { data, error } = await supabase
    .from("website_visits")
    .select(`
      id, organization_id, company_id, lead_id, source, page_url, page_title,
      referrer_url, visitor_id, occurred_at, payload,
      companies (id, name, domain, website_url, linkedin_url, industry, employee_count, country, metadata),
      leads (id, first_name, last_name, job_title, email, phone, linkedin_url, status, icp_score, metadata)
    `)
    .eq("organization_id", organizationId)
    .order("occurred_at", { ascending: false })
    .limit(500);

  if (error) console.error("Could not load website visitors:", error);

  const visits = (data ?? []) as WebsiteVisitRow[];
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
    if (selectedType === "person" && model.profileType !== "person")
      return false;
    if (selectedType === "company" && model.profileType !== "company")
      return false;
    if (query && !visitorSearchText(model).includes(query)) return false;
    return true;
  });

  const filters: Array<{ key: FilterType; label: string; count: number }> = [
    { key: "all", label: "All", count: rows.length },
    { key: "person", label: "People", count: personCount },
    { key: "company", label: "Companies", count: companyCount },
  ];

  return (
    <AppShell
      active="visitors"
      organizationName={organizationName}
      email={email}
      role={role}
      title="Website visitors"
      description="RB2B people and companies, with direct LinkedIn links, company context and website intent."
    >
      <SectionCard className="overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 lg:flex-row lg:items-center lg:justify-between sm:px-6">
          <div className="flex flex-wrap gap-2">
            {filters.map((filter) => (
              <Link
                key={filter.key}
                href={filterHref(filter.key, params.q ?? "")}
                className={`rounded-xl px-3.5 py-2 text-sm font-semibold transition ${
                  selectedType === filter.key
                    ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100"
                    : "bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                }`}
              >
                {filter.label}
                <span className="ml-1 text-xs opacity-70">{filter.count}</span>
              </Link>
            ))}
          </div>

          <form method="get" className="flex w-full gap-2 lg:max-w-md">
            {selectedType !== "all" ? (
              <input type="hidden" name="type" value={selectedType} />
            ) : null}
            <input
              name="q"
              type="search"
              defaultValue={params.q ?? ""}
              placeholder="Search person, company or page..."
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50"
            />
            <button className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">
              Search
            </button>
          </form>
        </div>

        <div className="flex items-center justify-between px-5 py-4 sm:px-6">
          <p className="text-sm text-slate-500">
            <span className="font-semibold text-slate-800">
              {filteredRows.length}
            </span>{" "}
            result{filteredRows.length === 1 ? "" : "s"}
            {query ? ` matching “${params.q}”` : ""}
          </p>
          {query || selectedType !== "all" ? (
            <Link
              href="/visitors"
              className="text-sm font-semibold text-indigo-600"
            >
              Clear filters
            </Link>
          ) : null}
        </div>

        {filteredRows.length === 0 ? (
          <div className="border-t border-slate-100 px-6 py-14 text-center text-sm text-slate-500">
            No visitors match the current filters.
          </div>
        ) : (
          <div className="overflow-x-auto border-t border-slate-100">
            <table className="w-full min-w-[880px] table-fixed text-left text-sm">
              <thead className="bg-slate-50/80 text-[11px] uppercase tracking-[0.08em] text-slate-400">
                <tr>
                  <th className="w-[18%] px-4 py-4 font-bold">Visitor</th>
                  <th className="w-[18%] px-3 py-4 font-bold">Company</th>
                  <th className="w-[16%] px-3 py-4 font-bold">Role / type</th>
                  <th className="w-[20%] px-3 py-4 font-bold">Intent</th>
                  <th className="w-[7%] px-3 py-4 font-bold">Score</th>
                  <th className="w-[12%] px-3 py-4 font-bold">Priority</th>
                  <th className="w-[9%] px-3 py-4 font-bold" />
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {filteredRows.map(({ visit, model }) => {
                  const visitorLinkedIn =
                    model.profileType === "person"
                      ? model.personLinkedInUrl
                      : model.companyLinkedInUrl;

                  return (
                    <tr
                      key={visit.id}
                      className="group transition hover:bg-indigo-50/20"
                    >
                      <td className="px-3 py-4 align-top">
                        <div className="flex items-start gap-3">
                          <div
                            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                              model.profileType === "person"
                                ? "bg-sky-50 text-sky-700"
                                : "bg-violet-50 text-violet-700"
                            }`}
                          >
                            {model.displayName.slice(0, 1).toUpperCase()}
                          </div>

                          <div className="min-w-0">
                            <p className="truncate">
                              <ExternalName href={visitorLinkedIn}>
                                {model.displayName}
                              </ExternalName>
                            </p>
                            <p className="mt-1 truncate text-xs text-slate-400">
                              {visitorLinkedIn
                                ? "LinkedIn available"
                                : model.location ??
                                  model.maskedEmail ??
                                  "No LinkedIn captured"}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="px-3 py-4 align-top">
                        <p className="truncate text-slate-600">
                          <ExternalName href={model.companyLinkedInUrl}>
                            {model.companyName}
                          </ExternalName>
                        </p>
                        {model.companyDomain ? (
                          <p className="mt-1 truncate text-xs text-slate-400">
                            {model.companyDomain}
                          </p>
                        ) : null}
                      </td>

                      <td className="px-3 py-4 align-top text-slate-600">
                        <p className="line-clamp-2">
                          {model.profileType === "person"
                            ? model.jobTitle ?? "Role unknown"
                            : model.industry ?? "Company"}
                        </p>
                      </td>

                      <td className="px-3 py-4 align-top">
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
                          <span className="text-slate-400">—</span>
                        )}
                        <p className="mt-1 text-xs text-slate-400">
                          {formatDateTime(model.occurredAt)}
                        </p>
                      </td>

                      <td className="px-3 py-4 align-top">
                        <span className="font-bold text-slate-900">
                          {model.profileType === "person"
                            ? model.icpScore ?? "—"
                            : "—"}
                        </span>
                      </td>

                      <td className="px-3 py-4 align-top">
                        {model.profileType === "person" && priorityForScore(model.icpScore) ? (
                          <StatusPill tone={priorityForScore(model.icpScore)!.tone}>
                            {priorityForScore(model.icpScore)!.label}
                          </StatusPill>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      <td className="px-3 py-4 text-right align-top">
                        <Link
                          href={`/visitors/${visit.id}`}
                          className="inline-flex rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-indigo-200 hover:text-indigo-700"
                        >
                          Details →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </AppShell>
  );
}
