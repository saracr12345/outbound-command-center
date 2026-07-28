import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  parseRb2bSlackMessage,
  type ParsedRb2bVisitor,
  type SlackMessageEvent,
} from "@/lib/slack/parse-rb2b-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;

type SlackPayload = {
  type?: string;
  challenge?: string;
  event_id?: string;
  event_time?: number;
  team_id?: string;
  event?: SlackMessageEvent;
};

type ExistingCompany = {
  id: string;
  name: string;
  domain: string | null;
  website_url: string | null;
  industry: string | null;
  employee_count: number | null;
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

function safeCompare(receivedValue: string, expectedValue: string): boolean {
  const received = Buffer.from(receivedValue);
  const expected = Buffer.from(expectedValue);

  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}

function verifySlackRequest(
  rawBody: string,
  timestamp: string,
  receivedSignature: string,
): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.error("SLACK_SIGNING_SECRET is not configured.");
    return false;
  }

  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber)) return false;

  const currentTimestamp = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTimestamp - timestampNumber) > 60 * 5) return false;

  const signatureBaseString = `v0:${timestamp}:${rawBody}`;
  const expectedSignature = `v0=${createHmac("sha256", signingSecret)
    .update(signatureBaseString)
    .digest("hex")}`;

  return safeCompare(receivedSignature, expectedSignature);
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeMetadata(
  existing: JsonObject | null,
  slackRb2b: JsonObject,
): JsonObject {
  const existingSlackRb2b =
    existing && isRecord(existing.slack_rb2b)
      ? (existing.slack_rb2b as JsonObject)
      : {};

  return {
    ...(existing ?? {}),
    slack_rb2b: {
      ...existingSlackRb2b,
      ...slackRb2b,
    },
  };
}

function eventHash(payload: SlackPayload): string {
  const event = payload.event;

  return createHash("sha256")
    .update(
      JSON.stringify({
        eventId: payload.event_id ?? null,
        channel: event?.channel ?? null,
        botId: event?.bot_id ?? null,
        timestamp: event?.event_ts ?? event?.ts ?? null,
        text: event?.text ?? null,
      }),
    )
    .digest("hex");
}

function slackTimestampToIso(value: string | undefined): string | null {
  if (!value) return null;

  const seconds = Number.parseFloat(value);
  if (!Number.isFinite(seconds)) return null;

  return new Date(seconds * 1000).toISOString();
}

async function findOrCreateCompany(
  organizationId: string,
  visitor: ParsedRb2bVisitor,
): Promise<string | null> {
  if (!visitor.companyName && !visitor.companyDomain) return null;

  const admin = createAdminClient();
  let existing: ExistingCompany | null = null;

  if (visitor.companyDomain) {
    const { data, error } = await admin
      .from("companies")
      .select(
        "id, name, domain, website_url, industry, employee_count, metadata",
      )
      .eq("organization_id", organizationId)
      .eq("domain", visitor.companyDomain)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    existing = data as ExistingCompany | null;
  }

  if (!existing && visitor.companyName) {
    const { data, error } = await admin
      .from("companies")
      .select(
        "id, name, domain, website_url, industry, employee_count, metadata",
      )
      .eq("organization_id", organizationId)
      .ilike("name", visitor.companyName)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    existing = data as ExistingCompany | null;
  }

  const metadata = mergeMetadata(existing?.metadata ?? null, {
    profile_type: visitor.profileType,
    location: visitor.location,
    employee_count_raw: visitor.employeeCountRaw,
    estimated_revenue: visitor.estimatedRevenue,
    page_views: visitor.pageViews,
    last_received_at: new Date().toISOString(),
    raw_text: visitor.rawText,
  });

  if (existing) {
    const update: JsonObject = { metadata };

    if (visitor.companyName) update.name = visitor.companyName;
    if (visitor.companyDomain) update.domain = visitor.companyDomain;
    if (visitor.companyWebsite) update.website_url = visitor.companyWebsite;
    if (visitor.industry) update.industry = visitor.industry;
    if (visitor.employeeCount !== null) {
      update.employee_count = visitor.employeeCount;
    }

    const { error } = await admin
      .from("companies")
      .update(update)
      .eq("id", existing.id);

    if (error) throw error;
    return existing.id;
  }

  const { data, error } = await admin
    .from("companies")
    .insert({
      organization_id: organizationId,
      name: visitor.companyName ?? visitor.companyDomain ?? "Unknown company",
      domain: visitor.companyDomain,
      website_url: visitor.companyWebsite,
      industry: visitor.industry,
      employee_count: visitor.employeeCount,
      metadata,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw error ?? new Error("Could not create company from Slack alert.");
  }

  return data.id as string;
}

async function findOrCreateLead(
  organizationId: string,
  companyId: string | null,
  visitor: ParsedRb2bVisitor,
): Promise<string | null> {
  if (visitor.profileType !== "person") return null;

  const hasIdentity = Boolean(
    visitor.firstName ||
      visitor.lastName ||
      visitor.email ||
      visitor.linkedinUrl,
  );

  if (!hasIdentity) return null;

  const admin = createAdminClient();
  let existing: ExistingLead | null = null;

  if (visitor.linkedinUrl) {
    const { data, error } = await admin
      .from("leads")
      .select(
        "id, company_id, first_name, last_name, job_title, email, linkedin_url, metadata",
      )
      .eq("organization_id", organizationId)
      .eq("linkedin_url", visitor.linkedinUrl)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    existing = data as ExistingLead | null;
  }

  if (!existing && visitor.email) {
    const { data, error } = await admin
      .from("leads")
      .select(
        "id, company_id, first_name, last_name, job_title, email, linkedin_url, metadata",
      )
      .eq("organization_id", organizationId)
      .ilike("email", visitor.email)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    existing = data as ExistingLead | null;
  }

  if (
    !existing &&
    companyId &&
    visitor.firstName &&
    visitor.lastName
  ) {
    const { data, error } = await admin
      .from("leads")
      .select(
        "id, company_id, first_name, last_name, job_title, email, linkedin_url, metadata",
      )
      .eq("organization_id", organizationId)
      .eq("company_id", companyId)
      .ilike("first_name", visitor.firstName)
      .ilike("last_name", visitor.lastName)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    existing = data as ExistingLead | null;
  }

  const metadata = mergeMetadata(existing?.metadata ?? null, {
    masked_email: visitor.maskedEmail,
    location: visitor.location,
    page_views: visitor.pageViews,
    last_page_url: visitor.pageUrl,
    last_seen_at: visitor.occurredAt,
    last_received_at: new Date().toISOString(),
    raw_text: visitor.rawText,
  });

  if (existing) {
    const update: JsonObject = { metadata };

    if (companyId) update.company_id = companyId;
    if (visitor.firstName) update.first_name = visitor.firstName;
    if (visitor.lastName) update.last_name = visitor.lastName;
    if (visitor.jobTitle) update.job_title = visitor.jobTitle;
    if (visitor.email) update.email = visitor.email;
    if (visitor.linkedinUrl) update.linkedin_url = visitor.linkedinUrl;

    const { error } = await admin
      .from("leads")
      .update(update)
      .eq("id", existing.id);

    if (error) throw error;
    return existing.id;
  }

  const { data, error } = await admin
    .from("leads")
    .insert({
      organization_id: organizationId,
      company_id: companyId,
      first_name: visitor.firstName,
      last_name: visitor.lastName,
      job_title: visitor.jobTitle,
      email: visitor.email,
      linkedin_url: visitor.linkedinUrl,
      source: "rb2b",
      status: "new",
      metadata,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw error ?? new Error("Could not create lead from Slack alert.");
  }

  return data.id as string;
}

async function updateRb2bIntegration(
  organizationId: string,
  status: "connected" | "error",
  details: JsonObject,
): Promise<void> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("integration_connections")
    .select("config")
    .eq("organization_id", organizationId)
    .eq("provider", "rb2b")
    .maybeSingle();

  const config = existing?.config && isRecord(existing.config)
    ? (existing.config as JsonObject)
    : {};

  await admin.from("integration_connections").upsert(
    {
      organization_id: organizationId,
      provider: "rb2b",
      status,
      last_synced_at: status === "connected" ? new Date().toISOString() : null,
      config: {
        ...config,
        ingestion_method: "slack_events_api",
        ...details,
      },
    },
    { onConflict: "organization_id,provider" },
  );
}

async function processSlackEvent(payload: SlackPayload): Promise<void> {
  const organizationId = process.env.RB2B_ORGANIZATION_ID;
  const expectedChannelId = process.env.SLACK_RB2B_CHANNEL_ID;
  const expectedBotId = process.env.SLACK_RB2B_BOT_ID;
  const event = payload.event;

  if (!organizationId || !expectedChannelId || !expectedBotId) {
    console.error("Slack RB2B ingestion environment variables are missing.");
    return;
  }

  if (!event || event.type !== "message") return;
  if (event.channel !== expectedChannelId) return;
  if (event.bot_id !== expectedBotId) return;

  const admin = createAdminClient();
  const hash = payload.event_id ?? eventHash(payload);

  const { data: webhookEvent, error: insertError } = await admin
    .from("webhook_events")
    .insert({
      organization_id: organizationId,
      provider: "slack",
      event_hash: hash,
      status: "processing",
      payload: payload as unknown as JsonObject,
    })
    .select("id")
    .single();

  if (insertError?.code === "23505") {
    console.log("Ignored duplicate Slack RB2B event:", hash);
    return;
  }

  if (insertError || !webhookEvent) {
    throw insertError ?? new Error("Could not log Slack webhook event.");
  }

  try {
    const visitor = parseRb2bSlackMessage(event);

    if (!visitor) {
      await admin
        .from("webhook_events")
        .update({
          status: "ignored",
          error_message: "RB2B Slack message could not be parsed.",
          processed_at: new Date().toISOString(),
        })
        .eq("id", webhookEvent.id);

      console.warn("Ignored unparseable RB2B Slack message:", hash);
      return;
    }

    const companyId = await findOrCreateCompany(organizationId, visitor);
    const leadId = await findOrCreateLead(
      organizationId,
      companyId,
      visitor,
    );

    const occurredAt =
      visitor.occurredAt ??
      slackTimestampToIso(event.event_ts ?? event.ts) ??
      new Date().toISOString();

    const visitorId =
      visitor.linkedinUrl ??
      visitor.email ??
      visitor.fullName ??
      visitor.companyDomain ??
      visitor.companyName ??
      hash;

    const { data: visit, error: visitError } = await admin
      .from("website_visits")
      .insert({
        organization_id: organizationId,
        company_id: companyId,
        lead_id: leadId,
        source: "rb2b-slack",
        page_url: visitor.pageUrl,
        visitor_id: visitorId,
        occurred_at: occurredAt,
        payload: {
          slack_event_id: payload.event_id ?? null,
          slack_channel_id: event.channel ?? null,
          slack_bot_id: event.bot_id ?? null,
          parsed: visitor,
          raw_event: payload,
        },
      })
      .select("id")
      .single();

    if (visitError || !visit) {
      throw visitError ?? new Error("Could not create website visit.");
    }

    const displayName =
      visitor.fullName ?? visitor.companyName ?? "RB2B visitor";

    const { error: activityError } = await admin
      .from("activities")
      .insert({
        organization_id: organizationId,
        lead_id: leadId,
        company_id: companyId,
        activity_type: visitor.isRepeatVisit
          ? "website.repeat_visit"
          : "website.visit",
        title: visitor.isRepeatVisit
          ? `${displayName} returned to the website`
          : `${displayName} visited the website`,
        description: visitor.pageUrl
          ? `Viewed ${visitor.pageUrl}`
          : "Visitor profile received through RB2B and Slack.",
        occurred_at: occurredAt,
        metadata: {
          visit_id: visit.id,
          ingestion_method: "slack_events_api",
          profile_type: visitor.profileType,
          page_views: visitor.pageViews,
        },
      });

    if (activityError) {
      console.error("Could not create Slack RB2B activity:", activityError);
    }

    await admin
      .from("webhook_events")
      .update({
        status: "completed",
        processed_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("id", webhookEvent.id);

    await updateRb2bIntegration(organizationId, "connected", {
      slack_channel_id: event.channel,
      slack_bot_id: event.bot_id,
      last_event_id: payload.event_id ?? null,
      last_event_status: "completed",
      last_webhook_at: new Date().toISOString(),
    });

    console.log("Stored RB2B visitor from Slack:", {
      eventId: payload.event_id,
      profileType: visitor.profileType,
      companyId,
      leadId,
      visitId: visit.id,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown Slack processing error.";

    await admin
      .from("webhook_events")
      .update({
        status: "failed",
        error_message: errorMessage.slice(0, 2000),
        processed_at: new Date().toISOString(),
      })
      .eq("id", webhookEvent.id);

    await updateRb2bIntegration(organizationId, "error", {
      slack_channel_id: event.channel,
      slack_bot_id: event.bot_id,
      last_event_id: payload.event_id ?? null,
      last_event_status: "failed",
      last_error: errorMessage.slice(0, 500),
      last_webhook_at: new Date().toISOString(),
    });

    console.error("Slack RB2B ingestion failed:", error);
  }
}

export async function GET() {
  return Response.json({
    ok: true,
    service: "slack-webhook",
  });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";
  const signature = request.headers.get("x-slack-signature") ?? "";

  if (!verifySlackRequest(rawBody, timestamp, signature)) {
    return Response.json(
      { ok: false, error: "invalid_signature" },
      { status: 401 },
    );
  }

  let payload: SlackPayload;

  try {
    const parsed: unknown = JSON.parse(rawBody);

    if (!isRecord(parsed)) {
      throw new Error("Slack payload must be an object.");
    }

    payload = parsed as SlackPayload;
  } catch {
    return Response.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  if (
    payload.type === "url_verification" &&
    typeof payload.challenge === "string"
  ) {
    return new Response(payload.challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  if (payload.type === "event_callback") {
    // Slack requires a fast acknowledgement. Next.js continues this work
    // after the HTTP response has been returned.
    after(async () => {
      await processSlackEvent(payload);
    });
  }

  return Response.json({ ok: true });
}
