import { createHash, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;

type ExistingCompany = {
  id: string;
  name: string;
  domain: string | null;
  website_url: string | null;
  industry: string | null;
  employee_count: number | null;
  country: string | null;
  metadata: JsonObject | null;
};

type ExistingLead = {
  id: string;
  company_id: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  email: string | null;
  linkedin_url: string | null;
  metadata: JsonObject | null;
};

function acknowledge(
  body: JsonObject,
): Response {
  // RB2B requires HTTP 200 for webhook responses.
  return Response.json(body, { status: 200 });
}

function readString(
  payload: JsonObject,
  key: string,
): string | null {
  const value = payload[key];

  if (typeof value === "string") {
    const cleaned = value.trim();
    return cleaned.length > 0 ? cleaned : null;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return null;
}

function readBoolean(
  payload: JsonObject,
  ...keys: string[]
): boolean {
  for (const key of keys) {
    const value = payload[key];

    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      const normalized = value.toLowerCase().trim();

      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
  }

  return false;
}

function normalizeEmail(
  value: string | null,
): string | null {
  return value ? value.toLowerCase() : null;
}

function normalizeUrl(
  value: string | null,
): string | null {
  if (!value) return null;

  try {
    const url = new URL(
      value.startsWith("http://") || value.startsWith("https://")
        ? value
        : `https://${value}`,
    );

    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.replace(/\/$/, "");
  }
}

function normalizeLinkedInUrl(
  value: string | null,
): string | null {
  const normalized = normalizeUrl(value);

  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    url.search = "";
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return normalized.toLowerCase();
  }
}

function extractDomain(
  website: string | null,
): string | null {
  if (!website) return null;

  try {
    const url = new URL(
      website.startsWith("http://") || website.startsWith("https://")
        ? website
        : `https://${website}`,
    );

    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return website
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0] || null;
  }
}

function parseEmployeeCount(
  value: unknown,
): number | null {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0
  ) {
    return value;
  }

  if (
    typeof value === "string" &&
    /^\d+$/.test(value.trim())
  ) {
    return Number.parseInt(value.trim(), 10);
  }

  // RB2B often sends ranges such as "1-10". Keep those in metadata
  // rather than pretending the range is one exact employee count.
  return null;
}

function parseSeenAt(
  value: string | null,
): string {
  if (!value) return new Date().toISOString();

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString()
    : parsed.toISOString();
}

function constantTimeEquals(
  received: string,
  expected: string,
): boolean {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(receivedBuffer, expectedBuffer);
}

function eventHash(input: {
  seenAt: string | null;
  capturedUrl: string | null;
  linkedinUrl: string | null;
  email: string | null;
  companyName: string | null;
  firstName: string | null;
  lastName: string | null;
}): string {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
}

function mergeMetadata(
  existing: JsonObject | null,
  rb2b: JsonObject,
): JsonObject {
  const existingRb2b = existing?.["rb2b"];
  const rb2bObject =
    typeof existingRb2b === "object" &&
    existingRb2b !== null &&
    !Array.isArray(existingRb2b)
      ? (existingRb2b as JsonObject)
      : {};

  return {
    ...(existing ?? {}),
    rb2b: {
      ...rb2bObject,
      ...rb2b,
    },
  };
}

async function updateIntegrationStatus(
  organizationId: string,
  status: "connected" | "error",
  details: JsonObject,
) {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("integration_connections")
    .select("config")
    .eq("organization_id", organizationId)
    .eq("provider", "rb2b")
    .maybeSingle();

  const existingConfig =
    existing?.config &&
    typeof existing.config === "object" &&
    !Array.isArray(existing.config)
      ? (existing.config as JsonObject)
      : {};

  const now = new Date().toISOString();

  await admin
    .from("integration_connections")
    .upsert(
      {
        organization_id: organizationId,
        provider: "rb2b",
        status,
        last_synced_at: status === "connected" ? now : null,
        config: {
          ...existingConfig,
          ...details,
          last_webhook_at: now,
        },
      },
      {
        onConflict: "organization_id,provider",
      },
    );
}

async function findOrCreateCompany(
  payload: JsonObject,
  organizationId: string,
): Promise<string | null> {
  const admin = createAdminClient();

  const companyName = readString(payload, "Company Name");
  const websiteUrl = normalizeUrl(readString(payload, "Website"));
  const domain = extractDomain(websiteUrl);
  const industry = readString(payload, "Industry");
  const employeeCountRaw = payload["Employee Count"];
  const employeeCount = parseEmployeeCount(employeeCountRaw);
  const city = readString(payload, "City");
  const state = readString(payload, "State");
  const zipcode = readString(payload, "Zipcode");
  const estimatedRevenue = readString(payload, "Estimate Revenue");

  if (!companyName && !domain) {
    return null;
  }

  let existing: ExistingCompany | null = null;

  if (domain) {
    const { data, error } = await admin
      .from("companies")
      .select(
        "id, name, domain, website_url, industry, employee_count, country, metadata",
      )
      .eq("organization_id", organizationId)
      .eq("domain", domain)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    existing = data as ExistingCompany | null;
  }

  if (!existing && companyName) {
    const { data, error } = await admin
      .from("companies")
      .select(
        "id, name, domain, website_url, industry, employee_count, country, metadata",
      )
      .eq("organization_id", organizationId)
      .ilike("name", companyName)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    existing = data as ExistingCompany | null;
  }

  const rb2bMetadata: JsonObject = {
    estimated_revenue: estimatedRevenue,
    employee_count_raw:
      typeof employeeCountRaw === "string" ||
      typeof employeeCountRaw === "number"
        ? employeeCountRaw
        : null,
    city,
    state,
    zipcode,
    last_received_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await admin
      .from("companies")
      .update({
        name: companyName ?? existing.name,
        domain: domain ?? existing.domain,
        website_url: websiteUrl ?? existing.website_url,
        industry: industry ?? existing.industry,
        employee_count:
          employeeCount ?? existing.employee_count,
        metadata: mergeMetadata(
          existing.metadata,
          rb2bMetadata,
        ),
      })
      .eq("id", existing.id);

    if (error) throw error;
    return existing.id;
  }

  const { data, error } = await admin
    .from("companies")
    .insert({
      organization_id: organizationId,
      name: companyName ?? domain ?? "Unknown company",
      domain,
      website_url: websiteUrl,
      industry,
      employee_count: employeeCount,
      metadata: mergeMetadata(null, rb2bMetadata),
    })
    .select("id")
    .single();

  if (error || !data) {
    throw error ?? new Error("Could not create the RB2B company.");
  }

  return data.id as string;
}

async function findOrCreateLead(
  payload: JsonObject,
  organizationId: string,
  companyId: string | null,
): Promise<string | null> {
  const admin = createAdminClient();

  const firstName = readString(payload, "First Name");
  const lastName = readString(payload, "Last Name");
  const email = normalizeEmail(
    readString(payload, "Business Email"),
  );
  const linkedinUrl = normalizeLinkedInUrl(
    readString(payload, "LinkedIn URL"),
  );
  const jobTitle = readString(payload, "Title");
  const tags = readString(payload, "Tags");
  const isRepeatVisit = readBoolean(
    payload,
    "is_repeat_visit",
    "is_repeat_visitor",
  );

  const hasPersonIdentity =
    Boolean(firstName) ||
    Boolean(lastName) ||
    Boolean(email) ||
    Boolean(linkedinUrl);

  if (!hasPersonIdentity) {
    return null;
  }

  let existing: ExistingLead | null = null;

  if (linkedinUrl) {
    const { data, error } = await admin
      .from("leads")
      .select(
        "id, company_id, first_name, last_name, job_title, email, linkedin_url, metadata",
      )
      .eq("organization_id", organizationId)
      .eq("linkedin_url", linkedinUrl)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    existing = data as ExistingLead | null;
  }

  if (!existing && email) {
    const { data, error } = await admin
      .from("leads")
      .select(
        "id, company_id, first_name, last_name, job_title, email, linkedin_url, metadata",
      )
      .eq("organization_id", organizationId)
      .ilike("email", email)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    existing = data as ExistingLead | null;
  }

  if (
    !existing &&
    companyId &&
    firstName &&
    lastName
  ) {
    const { data, error } = await admin
      .from("leads")
      .select(
        "id, company_id, first_name, last_name, job_title, email, linkedin_url, metadata",
      )
      .eq("organization_id", organizationId)
      .eq("company_id", companyId)
      .ilike("first_name", firstName)
      .ilike("last_name", lastName)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    existing = data as ExistingLead | null;
  }

  const rb2bMetadata: JsonObject = {
    tags,
    is_repeat_visit: isRepeatVisit,
    last_seen_at: parseSeenAt(
      readString(payload, "Seen At"),
    ),
    last_captured_url: normalizeUrl(
      readString(payload, "Captured URL"),
    ),
    last_received_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await admin
      .from("leads")
      .update({
        company_id: companyId ?? existing.company_id,
        first_name: firstName ?? existing.first_name,
        last_name: lastName ?? existing.last_name,
        job_title: jobTitle ?? existing.job_title,
        email: email ?? existing.email,
        linkedin_url: linkedinUrl ?? existing.linkedin_url,
        metadata: mergeMetadata(
          existing.metadata,
          rb2bMetadata,
        ),
      })
      .eq("id", existing.id);

    if (error) throw error;
    return existing.id;
  }

  const { data, error } = await admin
    .from("leads")
    .insert({
      organization_id: organizationId,
      company_id: companyId,
      first_name: firstName,
      last_name: lastName,
      job_title: jobTitle,
      email,
      linkedin_url: linkedinUrl,
      source: "rb2b",
      status: "new",
      metadata: mergeMetadata(null, rb2bMetadata),
    })
    .select("id")
    .single();

  if (error || !data) {
    throw error ?? new Error("Could not create the RB2B lead.");
  }

  return data.id as string;
}

export async function GET() {
  return acknowledge({
    ok: true,
    service: "rb2b-webhook",
  });
}

export async function POST(request: Request) {
  const expectedToken = process.env.RB2B_WEBHOOK_TOKEN;
  const organizationId =
    process.env.RB2B_ORGANIZATION_ID;

  if (!expectedToken || !organizationId) {
    console.error(
      "RB2B webhook environment variables are missing.",
    );

    return acknowledge({
      ok: false,
      error: "server_not_configured",
    });
  }

  const requestUrl = new URL(request.url);
  const receivedToken =
    requestUrl.searchParams.get("token") ?? "";

  if (
    !receivedToken ||
    !constantTimeEquals(receivedToken, expectedToken)
  ) {
    console.warn("Rejected RB2B webhook with invalid token.");

    // RB2B disconnects webhooks that do not return HTTP 200.
    // The request is acknowledged but not processed.
    return acknowledge({
      ok: false,
      error: "unauthorized",
    });
  }

  let payload: JsonObject;

  try {
    const parsed: unknown = await request.json();

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error("Payload must be a JSON object.");
    }

    payload = parsed as JsonObject;
  } catch (error) {
    console.error("Invalid RB2B JSON payload:", error);

    return acknowledge({
      ok: false,
      error: "invalid_json",
    });
  }

  const seenAt = readString(payload, "Seen At");
  const capturedUrl = normalizeUrl(
    readString(payload, "Captured URL"),
  );
  const linkedinUrl = normalizeLinkedInUrl(
    readString(payload, "LinkedIn URL"),
  );
  const email = normalizeEmail(
    readString(payload, "Business Email"),
  );
  const companyName = readString(payload, "Company Name");
  const firstName = readString(payload, "First Name");
  const lastName = readString(payload, "Last Name");

  const hash = eventHash({
    seenAt,
    capturedUrl,
    linkedinUrl,
    email,
    companyName,
    firstName,
    lastName,
  });

  const admin = createAdminClient();

  const { data: event, error: eventInsertError } =
    await admin
      .from("webhook_events")
      .insert({
        organization_id: organizationId,
        provider: "rb2b",
        event_hash: hash,
        status: "processing",
        payload,
      })
      .select("id")
      .single();

  if (eventInsertError?.code === "23505") {
    return acknowledge({
      ok: true,
      duplicate: true,
    });
  }

  if (eventInsertError || !event) {
    console.error(
      "Could not record RB2B webhook:",
      eventInsertError,
    );

    return acknowledge({
      ok: false,
      error: "event_log_failed",
    });
  }

  try {
    const companyId = await findOrCreateCompany(
      payload,
      organizationId,
    );

    const leadId = await findOrCreateLead(
      payload,
      organizationId,
      companyId,
    );

    const isRepeatVisit = readBoolean(
      payload,
      "is_repeat_visit",
      "is_repeat_visitor",
    );

    const identityKey =
      linkedinUrl ??
      email ??
      (
        companyName &&
        (firstName || lastName)
          ? [
              companyName,
              firstName,
              lastName,
            ]
              .filter(Boolean)
              .join("|")
              .toLowerCase()
          : null
      );

    const { data: visit, error: visitError } = await admin
      .from("website_visits")
      .insert({
        organization_id: organizationId,
        company_id: companyId,
        lead_id: leadId,
        source: "rb2b",
        page_url: capturedUrl,
        referrer_url: normalizeUrl(
          readString(payload, "Referrer"),
        ),
        visitor_id: identityKey,
        occurred_at: parseSeenAt(seenAt),
        payload,
      })
      .select("id")
      .single();

    if (visitError || !visit) {
      throw (
        visitError ??
        new Error("Could not create the website visit.")
      );
    }

    const displayName =
      [firstName, lastName].filter(Boolean).join(" ") ||
      companyName ||
      "RB2B visitor";

    const activityTitle = isRepeatVisit
      ? `${displayName} returned to the website`
      : `${displayName} visited the website`;

    const { error: activityError } = await admin
      .from("activities")
      .insert({
        organization_id: organizationId,
        lead_id: leadId,
        company_id: companyId,
        activity_type: isRepeatVisit
          ? "website.repeat_visit"
          : "website.visit",
        title: activityTitle,
        description: capturedUrl
          ? `Viewed ${capturedUrl}`
          : "Website visit received from RB2B.",
        occurred_at: parseSeenAt(seenAt),
        metadata: {
          visit_id: visit.id,
          tags: readString(payload, "Tags"),
          is_repeat_visit: isRepeatVisit,
        },
      });

    if (activityError) {
      // The visit itself is already stored, so do not discard it.
      console.error(
        "Could not create RB2B activity:",
        activityError,
      );
    }

    const completedAt = new Date().toISOString();

    await admin
      .from("webhook_events")
      .update({
        status: "completed",
        processed_at: completedAt,
        error_message: null,
      })
      .eq("id", event.id);

    await updateIntegrationStatus(
      organizationId,
      "connected",
      {
        last_event_status: "completed",
        last_event_hash: hash,
      },
    );

    return acknowledge({
      ok: true,
      duplicate: false,
      company_id: companyId,
      lead_id: leadId,
      visit_id: visit.id,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Unknown RB2B processing error.";

    console.error(
      "RB2B webhook processing failed:",
      error,
    );

    await admin
      .from("webhook_events")
      .update({
        status: "failed",
        error_message: errorMessage.slice(0, 2000),
        processed_at: new Date().toISOString(),
      })
      .eq("id", event.id);

    await updateIntegrationStatus(
      organizationId,
      "error",
      {
        last_event_status: "failed",
        last_event_hash: hash,
        last_error: errorMessage.slice(0, 500),
      },
    );

    // Keep HTTP 200 so RB2B does not automatically disconnect.
    return acknowledge({
      ok: false,
      error: "processing_failed",
    });
  }
}
