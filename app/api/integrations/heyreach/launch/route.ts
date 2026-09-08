import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  addLeadToHeyReachCampaign,
  isHeyReachCampaignUnsafeToActivate,
  listHeyReachCampaigns,
} from "@/lib/heyreach/client";

function normalizeLinkedInUrl(value: string) {
  return value.trim().replace(/\/$/, "");
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId =
    typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "No organization membership" }, { status: 403 });
  }

  const organizationId = String(membership.organization_id);
  const body = await request.json().catch(() => null);
  const draftId = String(body?.draftId ?? "").trim();
  const campaignId = Number(body?.campaignId);
  const confirmPersonalization = body?.confirmPersonalization === true;

  if (!draftId || !Number.isInteger(campaignId) || campaignId <= 0) {
    return NextResponse.json(
      { error: "A valid approved draft and HeyReach campaign are required." },
      { status: 400 },
    );
  }

  if (!confirmPersonalization) {
    return NextResponse.json(
      {
        error:
          "Confirm that this HeyReach campaign uses the dashboard personalization variables before launching.",
      },
      { status: 400 },
    );
  }

  const { data: draft, error: draftError } = await supabase
    .from("outreach_drafts")
    .select(
      "id, organization_id, lead_id, visit_id, status, linkedin_connection_note, linkedin_followup",
    )
    .eq("organization_id", organizationId)
    .eq("id", draftId)
    .limit(1)
    .maybeSingle();

  if (draftError || !draft) {
    return NextResponse.json({ error: "Outreach draft not found." }, { status: 404 });
  }

  if (draft.status !== "approved") {
    return NextResponse.json(
      { error: "The outreach copy must be approved before it can be launched." },
      { status: 409 },
    );
  }

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select(
      "id, company_id, first_name, last_name, job_title, email, linkedin_url, metadata",
    )
    .eq("organization_id", organizationId)
    .eq("id", draft.lead_id)
    .limit(1)
    .maybeSingle();

  if (leadError || !lead) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }

  const firstName = String(lead.first_name ?? "").trim();
  const lastName = String(lead.last_name ?? "").trim();
  const linkedInUrl = normalizeLinkedInUrl(String(lead.linkedin_url ?? ""));

  if (!firstName || !lastName || !linkedInUrl) {
    return NextResponse.json(
      {
        error:
          "HeyReach requires first name, last name and a LinkedIn profile URL. Complete those fields before launching.",
      },
      { status: 409 },
    );
  }

  if (!/^https?:\/\/(www\.)?linkedin\.com\/in\//i.test(linkedInUrl)) {
    return NextResponse.json(
      { error: "The lead does not have a valid person-level LinkedIn URL." },
      { status: 409 },
    );
  }

  const { data: suppressedLead } = await supabase
    .from("outreach_suppressions")
    .select("id, reason")
    .eq("organization_id", organizationId)
    .eq("active", true)
    .eq("lead_id", lead.id)
    .limit(1)
    .maybeSingle();

  if (suppressedLead) {
    return NextResponse.json(
      { error: `This lead is suppressed${suppressedLead.reason ? `: ${suppressedLead.reason}` : "."}` },
      { status: 409 },
    );
  }

  const { data: suppressedUrl } = await supabase
    .from("outreach_suppressions")
    .select("id, reason")
    .eq("organization_id", organizationId)
    .eq("active", true)
    .eq("linkedin_url", linkedInUrl)
    .limit(1)
    .maybeSingle();

  if (suppressedUrl) {
    return NextResponse.json(
      { error: `This LinkedIn profile is suppressed${suppressedUrl.reason ? `: ${suppressedUrl.reason}` : "."}` },
      { status: 409 },
    );
  }

  const { data: duplicateLaunch } = await supabase
    .from("outreach_launches")
    .select("id, status")
    .eq("organization_id", organizationId)
    .eq("lead_id", lead.id)
    .eq("provider", "heyreach")
    .eq("channel", "linkedin")
    .eq("external_campaign_id", String(campaignId))
    .in("status", ["submitting", "launched"])
    .limit(1)
    .maybeSingle();

  if (duplicateLaunch) {
    return NextResponse.json(
      { error: "This person has already been launched into that HeyReach campaign." },
      { status: 409 },
    );
  }

  let campaign;
  try {
    const campaigns = await listHeyReachCampaigns();
    campaign = campaigns.items.find((item) => Number(item.id) === campaignId);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not verify the HeyReach campaign.",
      },
      { status: 502 },
    );
  }

  if (!campaign) {
    return NextResponse.json(
      { error: "That HeyReach campaign no longer exists or is not accessible." },
      { status: 404 },
    );
  }

  if (isHeyReachCampaignUnsafeToActivate(campaign.status)) {
    return NextResponse.json(
      {
        error: `Campaign “${campaign.name}” is ${String(campaign.status ?? "not active").toLowerCase()}. This version only launches into an already-active campaign so we do not accidentally reactivate a paused or finished campaign.`,
      },
      { status: 409 },
    );
  }

  let companyName: string | null = null;
  if (lead.company_id) {
    const { data: company } = await supabase
      .from("companies")
      .select("name")
      .eq("organization_id", organizationId)
      .eq("id", lead.company_id)
      .limit(1)
      .maybeSingle();
    companyName = company?.name ?? null;
  }

  const { data: launch, error: launchError } = await supabase
    .from("outreach_launches")
    .insert({
      organization_id: organizationId,
      lead_id: lead.id,
      draft_id: draft.id,
      visit_id: draft.visit_id,
      provider: "heyreach",
      channel: "linkedin",
      external_campaign_id: String(campaign.id),
      external_campaign_name: campaign.name,
      status: "submitting",
      launched_by: userId,
      request_snapshot: {
        linkedin_url: linkedInUrl,
        first_name: firstName,
        last_name: lastName,
        campaign_status: campaign.status ?? null,
      },
    })
    .select("id")
    .single();

  if (launchError || !launch) {
    console.error("Could not create launch record:", launchError);
    return NextResponse.json(
      { error: "Could not create the launch record." },
      { status: 500 },
    );
  }

  try {
    const result = await addLeadToHeyReachCampaign({
      campaignId: Number(campaign.id),
      firstName,
      lastName,
      profileUrl: linkedInUrl,
      companyName,
      position: lead.job_title ?? null,
      emailAddress: lead.email ?? null,
      customUserFields: [
        {
          name: "linkedin_connection_note",
          value: String(draft.linkedin_connection_note ?? ""),
        },
        {
          name: "linkedin_followup",
          value: String(draft.linkedin_followup ?? ""),
        },
        { name: "source", value: "rb2b_dashboard" },
      ],
    });

    const accepted =
      Number(result?.addedLeadsCount ?? 0) +
        Number(result?.updatedLeadsCount ?? 0) >
      0;

    if (!accepted || Number(result?.failedLeadsCount ?? 0) > 0) {
      throw new Error(
        `HeyReach did not accept the lead. Response: ${JSON.stringify(result)}`,
      );
    }

    await supabase
      .from("outreach_launches")
      .update({
        status: "launched",
        provider_response: result,
        launched_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("organization_id", organizationId)
      .eq("id", launch.id);

    await supabase
      .from("leads")
      .update({ status: "campaign_active" })
      .eq("organization_id", organizationId)
      .eq("id", lead.id);

    await supabase.from("activities").insert({
      organization_id: organizationId,
      lead_id: lead.id,
      company_id: lead.company_id,
      actor_user_id: userId,
      activity_type: "outreach.heyreach_launched",
      title: `${firstName} ${lastName} launched to HeyReach`,
      description: `Added to ${campaign.name}`,
      metadata: {
        launch_id: launch.id,
        campaign_id: campaign.id,
        campaign_name: campaign.name,
        provider_response: result,
      },
    });

    await supabase.from("integration_connections").upsert(
      {
        organization_id: organizationId,
        provider: "heyreach",
        status: "connected",
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,provider" },
    );

    return NextResponse.json({
      ok: true,
      campaign: { id: campaign.id, name: campaign.name },
      result,
      launchId: launch.id,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "HeyReach launch failed.";

    await supabase
      .from("outreach_launches")
      .update({
        status: "failed",
        error_message: message,
      })
      .eq("organization_id", organizationId)
      .eq("id", launch.id);

    console.error("HeyReach launch failed:", error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
