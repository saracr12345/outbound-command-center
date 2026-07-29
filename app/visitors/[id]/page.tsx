import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { logout } from "@/app/dashboard/actions";
import { createClient } from "@/lib/supabase/server";
import {
  buildVisitorViewModel,
  formatDateTime,
  formatLabel,
  type VisitHistoryRow,
  type WebsiteVisitRow,
} from "@/lib/visitors/presentation";

type VisitorDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

function DetailItem({
  label,
  value,
  href,
}: {
  label: string;
  value: string | number | null;
  href?: string | null;
}) {
  const displayValue = value === null || value === "" ? "—" : String(value);

  return (
    <div className="rounded-xl border border-neutral-100 bg-neutral-50/70 px-4 py-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
        {label}
      </p>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="mt-2 block break-words text-sm font-semibold text-indigo-600 hover:text-indigo-700"
        >
          {displayValue}
        </a>
      ) : (
        <p className="mt-2 break-words text-sm font-semibold text-neutral-800">
          {displayValue}
        </p>
      )}
    </div>
  );
}

export default async function VisitorDetailPage({
  params,
}: VisitorDetailPageProps) {
  const { id } = await params;
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

  const [organizationResult, visitResult] = await Promise.all([
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
      .eq("id", id)
      .limit(1)
      .maybeSingle(),
  ]);

  if (visitResult.error) {
    console.error("Could not load visitor detail:", visitResult.error);
  }

  if (!visitResult.data) notFound();

  const visit = visitResult.data as WebsiteVisitRow;
  const model = buildVisitorViewModel(visit);

  let historyResult: {
    data: unknown[] | null;
    error: unknown;
  };

  const historySelect = "id, source, page_url, occurred_at, payload";

  if (visit.lead_id) {
    historyResult = await supabase
      .from("website_visits")
      .select(historySelect)
      .eq("organization_id", organizationId)
      .eq("lead_id", visit.lead_id)
      .order("occurred_at", { ascending: false })
      .limit(50);
  } else if (visit.company_id) {
    historyResult = await supabase
      .from("website_visits")
      .select(historySelect)
      .eq("organization_id", organizationId)
      .eq("company_id", visit.company_id)
      .is("lead_id", null)
      .order("occurred_at", { ascending: false })
      .limit(50);
  } else {
    historyResult = await supabase
      .from("website_visits")
      .select(historySelect)
      .eq("organization_id", organizationId)
      .eq("visitor_id", visit.visitor_id)
      .order("occurred_at", { ascending: false })
      .limit(50);
  }

  if (historyResult.error) {
    console.error("Could not load visitor history:", historyResult.error);
  }

  const history = (historyResult.data ?? []) as VisitHistoryRow[];
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
            <h1 className="mt-1 text-xl font-bold">Visitor details</h1>
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
        <div className="mb-8 flex flex-wrap items-center gap-4 text-sm font-semibold">
          <Link href="/dashboard" className="text-indigo-600 hover:text-indigo-700">
            ← Dashboard
          </Link>
          <span className="text-neutral-300">/</span>
          <Link href="/visitors" className="text-indigo-600 hover:text-indigo-700">
            Visitors
          </Link>
        </div>

        <section className="rounded-3xl border border-black/5 bg-white p-7 shadow-sm sm:p-9">
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-start">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={
                    model.profileType === "person"
                      ? "rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700"
                      : "rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700"
                  }
                >
                  {model.profileType === "person" ? "Person-level visitor" : "Company-level visitor"}
                </span>
                {model.isRepeatVisit ? (
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                    Repeat visit
                  </span>
                ) : null}
              </div>
              <h2 className="mt-5 text-3xl font-bold tracking-tight">
                {model.displayName}
              </h2>
              <p className="mt-2 text-base text-neutral-500">
                {model.profileType === "person"
                  ? [model.jobTitle, model.companyName].filter(Boolean).join(" · ")
                  : model.industry ?? model.companyDomain ?? "Company visitor"}
              </p>
            </div>

            <div className="rounded-2xl bg-neutral-950 px-5 py-4 text-white">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Captured
              </p>
              <p className="mt-2 font-semibold">
                {formatDateTime(model.occurredAt)}
              </p>
            </div>
          </div>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
            <h3 className="font-bold">
              {model.profileType === "person" ? "Person details" : "Visitor identity"}
            </h3>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <DetailItem label="Name" value={model.personName ?? model.displayName} />
              <DetailItem label="Job title" value={model.jobTitle} />
              <DetailItem label="Location" value={model.location} />
              <DetailItem label="Email" value={model.email ?? model.maskedEmail} />
              <DetailItem label="Phone" value={model.phone} />
              <DetailItem
                label="LinkedIn"
                value={model.personLinkedInUrl}
                href={model.personLinkedInUrl}
              />
              <DetailItem label="Lead status" value={model.leadStatus ? formatLabel(model.leadStatus) : null} />
              <DetailItem label="ICP score" value={model.icpScore} />
            </div>
          </section>

          <section className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
            <h3 className="font-bold">Company details</h3>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <DetailItem label="Company" value={model.companyName} />
              <DetailItem label="Industry" value={model.industry} />
              <DetailItem label="Domain" value={model.companyDomain} />
              <DetailItem
                label="Website"
                value={model.companyWebsite}
                href={model.companyWebsite}
              />
              <DetailItem
                label="Company LinkedIn"
                value={model.companyLinkedInUrl}
                href={model.companyLinkedInUrl}
              />
              <DetailItem
                label="Employees"
                value={model.employeeCountRaw ?? model.employeeCount}
              />
              <DetailItem label="Estimated revenue" value={model.estimatedRevenue} />
              <DetailItem label="Location" value={model.location} />
            </div>
          </section>
        </div>

        <section className="mt-6 rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
          <h3 className="font-bold">Visit details</h3>
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <DetailItem
              label="Page viewed"
              value={model.pageTitle ?? model.pageUrl}
              href={model.pageUrl}
            />
            <DetailItem
              label="Referrer"
              value={model.referrerUrl}
              href={model.referrerUrl}
            />
            <DetailItem label="Page views" value={model.pageViews} />
            <DetailItem label="Source" value={formatLabel(model.source)} />
          </div>
        </section>

        <section className="mt-6 overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
          <div className="border-b border-neutral-100 px-6 py-5">
            <h3 className="font-bold">Visit history</h3>
            <p className="mt-1 text-sm text-neutral-500">
              {history.length} recorded visit{history.length === 1 ? "" : "s"} for this profile.
            </p>
          </div>

          <div className="divide-y divide-neutral-100">
            {history.map((historyVisit) => (
              <div
                key={historyVisit.id}
                className="flex flex-col justify-between gap-3 px-6 py-5 sm:flex-row sm:items-center"
              >
                <div className="min-w-0">
                  {historyVisit.page_url ? (
                    <a
                      href={historyVisit.page_url}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate font-semibold text-indigo-600 hover:text-indigo-700"
                    >
                      {historyVisit.page_url}
                    </a>
                  ) : (
                    <p className="font-semibold">Page not supplied</p>
                  )}
                  <p className="mt-1 text-xs text-neutral-400">
                    {formatLabel(historyVisit.source)}
                  </p>
                </div>
                <p className="shrink-0 text-sm text-neutral-500">
                  {formatDateTime(historyVisit.occurred_at)}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
