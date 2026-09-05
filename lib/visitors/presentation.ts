export type JsonObject = Record<string, unknown>;

export type CompanyRelation = {
  id: string;
  name: string;
  domain: string | null;
  website_url: string | null;
  linkedin_url: string | null;
  industry: string | null;
  employee_count: number | null;
  country: string | null;
  metadata: JsonObject | null;
};

export type LeadRelation = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  status: string;
  icp_score: number | null;
  metadata: JsonObject | null;
};

export type WebsiteVisitRow = {
  id: string;
  organization_id: string;
  company_id: string | null;
  lead_id: string | null;
  source: string;
  page_url: string | null;
  page_title: string | null;
  referrer_url: string | null;
  visitor_id: string | null;
  occurred_at: string;
  payload: JsonObject | null;
  companies: CompanyRelation | CompanyRelation[] | null;
  leads: LeadRelation | LeadRelation[] | null;
};

export type VisitHistoryRow = Pick<
  WebsiteVisitRow,
  "id" | "source" | "page_url" | "occurred_at" | "payload"
>;

export type VisitorViewModel = {
  profileType: "person" | "company";
  displayName: string;
  personName: string | null;
  jobTitle: string | null;
  email: string | null;
  maskedEmail: string | null;
  personLinkedInUrl: string | null;
  phone: string | null;
  location: string | null;
  companyName: string;
  companyDomain: string | null;
  companyWebsite: string | null;
  companyLinkedInUrl: string | null;
  industry: string | null;
  employeeCount: number | null;
  employeeCountRaw: string | null;
  estimatedRevenue: string | null;
  pageUrl: string | null;
  pageTitle: string | null;
  referrerUrl: string | null;
  pageViews: number | null;
  isRepeatVisit: boolean;
  occurredAt: string;
  source: string;
  leadStatus: string | null;
  icpScore: number | null;
};

export function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function firstRelation<T>(
  relation: T | T[] | null,
): T | null {
  if (Array.isArray(relation)) return relation[0] ?? null;
  return relation;
}

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function readUnknown(
  record: JsonObject | null,
  keys: string[],
): unknown {
  if (!record) return null;

  const values = new Map<string, unknown>();

  for (const [key, value] of Object.entries(record)) {
    values.set(normaliseKey(key), value);
  }

  for (const key of keys) {
    const value = values.get(normaliseKey(key));
    if (value !== undefined && value !== null) return value;
  }

  return null;
}

function readString(
  record: JsonObject | null,
  keys: string[],
): string | null {
  const value = readUnknown(record, keys);

  if (typeof value === "string") {
    const cleaned = value.trim();
    return cleaned.length > 0 ? cleaned : null;
  }

  if (typeof value === "number") return String(value);
  return null;
}

function readNumber(
  record: JsonObject | null,
  keys: string[],
): number | null {
  const value = readUnknown(record, keys);

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }

  return null;
}

function readBoolean(
  record: JsonObject | null,
  keys: string[],
): boolean {
  const value = readUnknown(record, keys);

  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return false;
}

function nestedRecord(
  record: JsonObject | null,
  keys: string[],
): JsonObject | null {
  const value = readUnknown(record, keys);
  return isRecord(value) ? value : null;
}

function parsedPayload(payload: JsonObject | null): JsonObject | null {
  return nestedRecord(payload, ["parsed"]) ?? payload;
}

function slackMetadata(metadata: JsonObject | null): JsonObject | null {
  return nestedRecord(metadata, ["slack_rb2b", "rb2b"]);
}

function fullName(lead: LeadRelation | null): string | null {
  if (!lead) return null;

  const name = [lead.first_name, lead.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  return name || null;
}

function firstValue<T>(...values: Array<T | null | undefined>): T | null {
  for (const value of values) {
    if (value !== null && value !== undefined) return value;
  }

  return null;
}

export function buildVisitorViewModel(
  visit: WebsiteVisitRow,
): VisitorViewModel {
  const company = firstRelation(visit.companies);
  const lead = firstRelation(visit.leads);
  const parsed = parsedPayload(visit.payload);
  const leadMeta = slackMetadata(lead?.metadata ?? null);
  const companyMeta = slackMetadata(company?.metadata ?? null);

  const parsedProfileType = readString(parsed, [
    "profileType",
    "profile_type",
  ]);

  const profileType: "person" | "company" =
    lead || parsedProfileType?.toLowerCase() === "person"
      ? "person"
      : "company";

  const personName = firstValue(
    fullName(lead),
    readString(parsed, ["fullName", "name"]),
  );

  const companyName = firstValue(
    company?.name,
    readString(parsed, ["companyName", "company"]),
    "Unknown company",
  ) as string;

  const email = firstValue(
    lead?.email,
    readString(parsed, ["email", "businessEmail"]),
  );

  const maskedEmail = firstValue(
    readString(parsed, ["maskedEmail"]),
    readString(leadMeta, ["masked_email", "maskedEmail"]),
    email?.includes("*") ? email : null,
  );

  const location = firstValue(
    readString(parsed, ["location", "visitorLocation"]),
    readString(leadMeta, ["location"]),
    readString(companyMeta, ["location"]),
    company?.country,
  );

  const employeeCountRaw = firstValue(
    readString(parsed, ["employeeCountRaw", "estimatedEmployees"]),
    readString(companyMeta, ["employee_count_raw", "employeeCountRaw"]),
  );

  const pageViews = firstValue(
    readNumber(parsed, ["pageViews"]),
    readNumber(leadMeta, ["page_views", "pageViews"]),
    readNumber(companyMeta, ["page_views", "pageViews"]),
  );

  const pageUrl = firstValue(
    visit.page_url,
    readString(parsed, ["pageUrl", "capturedUrl"]),
    readString(leadMeta, ["last_page_url", "lastPageUrl"]),
  );

  const displayName =
    profileType === "person"
      ? personName ?? companyName
      : companyName;

  return {
    profileType,
    displayName,
    personName,
    jobTitle: firstValue(
      lead?.job_title,
      readString(parsed, ["jobTitle", "title"]),
    ),
    email: email && !email.includes("*") ? email : null,
    maskedEmail,
    personLinkedInUrl: firstValue(
      lead?.linkedin_url,
      readString(parsed, [
        "personLinkedInUrl",
        "personLinkedinUrl",
        "linkedinUrl",
        "linkedin",
      ]),
      readString(leadMeta, ["linkedin_url", "linkedinUrl"]),
    ),
    phone: lead?.phone ?? null,
    location,
    companyName,
    companyDomain: firstValue(
      company?.domain,
      readString(parsed, ["companyDomain"]),
    ),
    companyWebsite: firstValue(
      company?.website_url,
      readString(parsed, ["companyWebsite", "website"]),
    ),
    companyLinkedInUrl: firstValue(
      company?.linkedin_url,
      readString(parsed, [
        "companyLinkedInUrl",
        "companyLinkedinUrl",
        "companyLinkedin",
      ]),
      readString(companyMeta, ["linkedin_url", "linkedinUrl"]),
    ),
    industry: firstValue(
      company?.industry,
      readString(parsed, ["industry"]),
    ),
    employeeCount: firstValue(
      company?.employee_count,
      readNumber(parsed, ["employeeCount"]),
    ),
    employeeCountRaw,
    estimatedRevenue: firstValue(
      readString(parsed, ["estimatedRevenue", "estimateRevenue"]),
      readString(companyMeta, ["estimated_revenue", "estimatedRevenue"]),
    ),
    pageUrl,
    pageTitle: visit.page_title,
    referrerUrl: visit.referrer_url,
    pageViews,
    isRepeatVisit: readBoolean(parsed, ["isRepeatVisit", "is_repeat_visit"]),
    occurredAt: visit.occurred_at,
    source: visit.source,
    leadStatus: lead?.status ?? null,
    icpScore: lead?.icp_score ?? null,
  };
}

export function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatLabel(value: string): string {
  return value
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function visitorSearchText(model: VisitorViewModel): string {
  return [
    model.displayName,
    model.personName,
    model.jobTitle,
    model.email,
    model.maskedEmail,
    model.location,
    model.companyName,
    model.companyDomain,
    model.industry,
    model.pageUrl,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
