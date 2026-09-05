import Link from "next/link";
import { AppShell } from "@/app/components/app-shell";
import { SectionCard, StatusPill, scoreLabel, scoreTone } from "@/app/components/ui";
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

type FilterType = "all" | "person" | "company" | "strong";

function filterHref(type: FilterType, query: string) {
  const params = new URLSearchParams();
  if (type !== "all") params.set("type", type);
  if (query) params.set("q", query);
  const suffix = params.toString();
  return suffix ? `/visitors?${suffix}` : "/visitors";
}

export default async function VisitorsPage({ searchParams }: VisitorsPageProps) {
  const { supabase, organizationId, organizationName, email, role } = await getDashboardContext();
  const params = await searchParams;
  const selectedType: FilterType = ["person", "company", "strong"].includes(String(params.type))
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
  const rows = visits.map((visit) => ({ visit, model: buildVisitorViewModel(visit) }));
  const personCount = rows.filter(({ model }) => model.profileType === "person").length;
  const companyCount = rows.filter(({ model }) => model.profileType === "company").length;
  const strongCount = rows.filter(({ model }) => model.profileType === "person" && (model.icpScore ?? 0) >= 80).length;

  const filteredRows = rows.filter(({ model }) => {
    if (selectedType === "person" && model.profileType !== "person") return false;
    if (selectedType === "company" && model.profileType !== "company") return false;
    if (selectedType === "strong" && !(model.profileType === "person" && (model.icpScore ?? 0) >= 80)) return false;
    if (query && !visitorSearchText(model).includes(query)) return false;
    return true;
  });

  const filters: Array<{ key: FilterType; label: string; count: number }> = [
    { key: "all", label: "All", count: rows.length },
    { key: "person", label: "People", count: personCount },
    { key: "company", label: "Companies", count: companyCount },
    { key: "strong", label: "Strong targets", count: strongCount },
  ];

  return (
    <AppShell
      active="visitors"
      organizationName={organizationName}
      email={email}
      role={role}
      title="Website visitors"
      description="People and companies identified by RB2B, with LinkedIn, company context, browsing intent and AI targeting status."
    >
      <SectionCard>
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
                {filter.label} <span className="ml-1 text-xs opacity-70">{filter.count}</span>
              </Link>
            ))}
          </div>

          <form method="get" className="flex w-full gap-2 lg:max-w-md">
            {selectedType !== "all" ? <input type="hidden" name="type" value={selectedType} /> : null}
            <input
              name="q"
              type="search"
              defaultValue={params.q ?? ""}
              placeholder="Search person, company or page..."
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50"
            />
            <button className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">Search</button>
          </form>
        </div>

        <div className="flex items-center justify-between px-5 py-4 sm:px-6">
          <p className="text-sm text-slate-500">
            <span className="font-semibold text-slate-800">{filteredRows.length}</span> result{filteredRows.length === 1 ? "" : "s"}
            {query ? ` matching “${params.q}”` : ""}
          </p>
          {(query || selectedType !== "all") ? <Link href="/visitors" className="text-sm font-semibold text-indigo-600">Clear filters</Link> : null}
        </div>

        {filteredRows.length === 0 ? (
          <div className="border-t border-slate-100 px-6 py-14 text-center text-sm text-slate-500">No visitors match the current filters.</div>
        ) : (
          <div className="overflow-x-auto border-t border-slate-100">
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead className="bg-slate-50/80 text-[11px] uppercase tracking-[0.08em] text-slate-400">
                <tr>
                  <th className="px-6 py-4 font-bold">Visitor</th>
                  <th className="px-4 py-4 font-bold">Company</th>
                  <th className="px-4 py-4 font-bold">Role / type</th>
                  <th className="px-4 py-4 font-bold">Last page</th>
                  <th className="px-4 py-4 font-bold">AI score</th>
                  <th className="px-4 py-4 font-bold">Status</th>
                  <th className="px-4 py-4 font-bold">Last seen</th>
                  <th className="px-6 py-4 font-bold" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRows.map(({ visit, model }) => (
                  <tr key={visit.id} className="group transition hover:bg-indigo-50/20">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${model.profileType === "person" ? "bg-sky-50 text-sky-700" : "bg-violet-50 text-violet-700"}`}>
                          {model.displayName.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="max-w-[220px] truncate font-semibold text-slate-900">{model.displayName}</p>
                          <p className="mt-1 max-w-[220px] truncate text-xs text-slate-400">{model.location ?? model.maskedEmail ?? "—"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-slate-600">{model.companyName}</td>
                    <td className="px-4 py-4 text-slate-600">{model.profileType === "person" ? model.jobTitle ?? "Role unknown" : model.industry ?? "Company"}</td>
                    <td className="max-w-[240px] px-4 py-4">
                      {model.pageUrl ? <a href={model.pageUrl} target="_blank" rel="noreferrer" className="block truncate font-medium text-indigo-600 hover:text-indigo-700">{model.pageTitle ?? model.pageUrl}</a> : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-4"><span className="font-bold text-slate-900">{model.icpScore ?? "—"}</span></td>
                    <td className="px-4 py-4">
                      {model.profileType === "person" ? <StatusPill tone={scoreTone(model.icpScore)}>{scoreLabel(model.icpScore)}</StatusPill> : <StatusPill tone="blue">Company</StatusPill>}
                    </td>
                    <td className="px-4 py-4 text-xs text-slate-500">{formatDateTime(model.occurredAt)}</td>
                    <td className="px-6 py-4 text-right"><Link href={`/visitors/${visit.id}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition group-hover:border-indigo-200 group-hover:text-indigo-700">Open →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </AppShell>
  );
}
