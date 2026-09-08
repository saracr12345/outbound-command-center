"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postClayWebhook } from "@/lib/clay/client";
import {
  buildVisitorViewModel,
  firstRelation,
  type WebsiteVisitRow,
} from "@/lib/visitors/presentation";
import {
  analyseTarget as runTargetAnalysis,
  generateOutreach as runOutreachGeneration,
  type TargetContext,
} from "@/lib/ai/outbound";

function visitorUrl(
  visitId: string,
  kind?: "success" | "error",
  message?: string,
): string {
  if (!kind || !message) return `/visitors/${visitId}`;
  return `/visitors/${visitId}?${kind}=${encodeURIComponent(message)}`;
}

async function getContext(visitId: string) {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  const userId =
    typeof claimsData?.claims?.sub === "string"
      ? claimsData.claims.sub
      : null;

  if (claimsError || !userId) redirect("/login");

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (membershipError || !membership) {
    redirect(visitorUrl(visitId, "error", "Your team membership could not be loaded."));
  }

  const organizationId = membership.organization_id as string;

  const { data: visitData, error: visitError } = await supabase
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
    .eq("id", visitId)
    .limit(1)
    .maybeSingle();

  if (visitError || !visitData) {
    redirect(visitorUrl(visitId, "error", "The visitor could not be loaded."));
  }

  const visit = visitData as WebsiteVisitRow;
  const model = buildVisitorViewModel(visit);

  if (model.profileType !== "person" || !visit.lead_id) {
    redirect(
      visitorUrl(
        visitId,
        "error",
        "AI targeting is available only for person-level visitors.",
      ),
    );
  }

  const { data: history, error: historyError } = await supabase
    .from("website_visits")
    .select("id, page_url, page_title, occurred_at")
    .eq("organization_id", organizationId)
    .eq("lead_id", visit.lead_id)
    .order("occurred_at", { ascending: false })
    .limit(20);

  if (historyError) {
    console.error("Could not load visit history for AI context:", historyError);
  }

  const recentPages = Array.from(
    new Set(
      (history ?? [])
        .map((item) => item.page_title || item.page_url)
        .filter((value): value is string => Boolean(value)),
    ),
  ).slice(0, 10);

  const targetContext: TargetContext = {
    personName: model.personName,
    jobTitle: model.jobTitle,
    emailAvailable: Boolean(model.email),
    linkedInAvailable: Boolean(model.personLinkedInUrl),
    personLinkedInUrl: model.personLinkedInUrl,
    location: model.location,
    companyName: model.companyName,
    companyDomain: model.companyDomain,
    companyWebsite: model.companyWebsite,
    companyLinkedInUrl: model.companyLinkedInUrl,
    industry: model.industry,
    employeeCount: model.employeeCount,
    employeeCountRaw: model.employeeCountRaw,
    estimatedRevenue: model.estimatedRevenue,
    pageUrl: model.pageUrl,
    pageTitle: model.pageTitle,
    pageViews: model.pageViews,
    repeatVisit: model.isRepeatVisit,
    visitCount: history?.length ?? 1,
    recentPages,
  };

  return {
    supabase,
    userId,
    organizationId,
    visit,
    model,
    targetContext,
  };
}


async function getCompanySyncContext(visitId: string) {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  const userId =
    typeof claimsData?.claims?.sub === "string"
      ? claimsData.claims.sub
      : null;

  if (claimsError || !userId) redirect("/login");

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (membershipError || !membership) {
    redirect(
      visitorUrl(
        visitId,
        "error",
        "Your team membership could not be loaded.",
      ),
    );
  }

  const organizationId = membership.organization_id as string;

  const { data: visitData, error: visitError } = await supabase
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
    .eq("id", visitId)
    .limit(1)
    .maybeSingle();

  if (visitError || !visitData) {
    redirect(visitorUrl(visitId, "error", "The visitor could not be loaded."));
  }

  const visit = visitData as WebsiteVisitRow;
  const model = buildVisitorViewModel(visit);

  if (!visit.company_id) {
    redirect(
      visitorUrl(
        visitId,
        "error",
        "No company record is available for this visitor.",
      ),
    );
  }

  return {
    supabase,
    userId,
    organizationId,
    visit,
    model,
  };
}

export async function analyseTarget(formData: FormData) {
  const visitId = String(formData.get("visitId") ?? "").trim();
  if (!visitId) redirect("/visitors");

  const {
    supabase,
    userId,
    organizationId,
    visit,
    model,
    targetContext,
  } = await getContext(visitId);

  try {
    const analysis = await runTargetAnalysis(targetContext);

    const { data: savedAnalysis, error: analysisError } = await supabase
      .from("lead_analyses")
      .insert({
        organization_id: organizationId,
        lead_id: visit.lead_id,
        visit_id: visit.id,
        score: analysis.score,
        classification: analysis.classification,
        summary: analysis.summary,
        research: analysis.research,
        research_sources: analysis.researchSources,
        criteria: analysis.criteria,
        positive_signals: analysis.positive_signals,
        concerns: analysis.concerns,
        missing_information: analysis.missing_information,
        recommended_angle: analysis.recommended_angle,
        input_snapshot: targetContext,
        model: analysis.model,
        prompt_version: analysis.promptVersion,
        created_by: userId,
      })
      .select("id")
      .single();

    if (analysisError || !savedAnalysis) {
      throw analysisError ?? new Error("Could not save target analysis.");
    }

    const leadRecord = firstRelation(visit.leads);
    const researchCanFill =
      analysis.research.identity_match &&
      analysis.research.confidence !== "low";

    const leadMetadata = {
      ...(leadRecord?.metadata ?? {}),
      professional_web_research: {
        ...analysis.research,
        sources: analysis.researchSources,
        researched_at: new Date().toISOString(),
        prompt_version: analysis.promptVersion,
      },
    };

    const leadUpdate: Record<string, unknown> = {
      icp_score: analysis.score,
      metadata: leadMetadata,
    };

    // High-confidence professional research may refresh a stale RB2B title.
    // Medium-confidence research only fills the field when RB2B left it blank.
    if (analysis.research.current_job_title && researchCanFill) {
      const canRefreshExistingTitle = analysis.research.confidence === "high";
      if (!leadRecord?.job_title || canRefreshExistingTitle) {
        leadUpdate.job_title = analysis.research.current_job_title;
      }
    }

    const { error: leadUpdateError } = await supabase
      .from("leads")
      .update(leadUpdate)
      .eq("organization_id", organizationId)
      .eq("id", visit.lead_id);

    if (leadUpdateError) {
      console.error("Could not update lead after AI research:", leadUpdateError);
    }

    const { error: activityError } = await supabase
      .from("activities")
      .insert({
        organization_id: organizationId,
        lead_id: visit.lead_id,
        company_id: visit.company_id,
        actor_user_id: userId,
        activity_type: "ai.target_analysis",
        title: `${model.displayName} received an AI target score of ${analysis.score}`,
        description: analysis.summary,
        metadata: {
          analysis_id: savedAnalysis.id,
          classification: analysis.classification,
          researched_job_title: analysis.research.current_job_title,
          researched_company: analysis.research.current_company,
          research_confidence: analysis.research.confidence,
          research_source_count: analysis.researchSources.length,
          prompt_version: analysis.promptVersion,
        },
      });

    if (activityError) {
      console.error("Could not record AI analysis activity:", activityError);
    }
  } catch (error) {
    console.error("Target analysis failed:", error);
    const message =
      error instanceof Error ? error.message : "Target analysis failed.";
    redirect(visitorUrl(visitId, "error", message));
  }

  revalidatePath(`/visitors/${visitId}`);
  revalidatePath("/visitors");
  revalidatePath("/dashboard");
  redirect(visitorUrl(visitId, "success", "Target analysis completed."));
}


function claySyncReady(sync: {
  target_status?: string | null;
  person_status?: string | null;
  company_status?: string | null;
} | null) {
  if (!sync || sync.target_status !== "approved") return false;
  if (sync.person_status !== "synced") return false;
  return sync.company_status === "synced" || sync.company_status === "skipped";
}


export async function syncCompanyToClay(formData: FormData) {
  const visitId = String(formData.get("visitId") ?? "").trim();
  if (!visitId) redirect("/visitors");

  const {
    supabase,
    userId,
    organizationId,
    visit,
    model,
  } = await getCompanySyncContext(visitId);

  const { data: existing, error: existingError } = await supabase
    .from("clay_company_syncs")
    .select("id, status")
    .eq("organization_id", organizationId)
    .eq("company_id", visit.company_id)
    .limit(1)
    .maybeSingle();

  if (existingError) {
    console.error("Could not load Clay company sync:", existingError);
    redirect(
      visitorUrl(visitId, "error", "Company Clay sync status could not be loaded."),
    );
  }

  if (existing?.status === "synced") {
    redirect(
      visitorUrl(
        visitId,
        "success",
        "This company is already synced to Clay Companies.",
      ),
    );
  }

  const companyPayload: Record<string, unknown> = {
    dashboard_company_id: visit.company_id,
    dashboard_visit_id: visit.id,
    source: "rb2b_dashboard",
    company_sync_requested: true,
    company_name: model.companyName,
    domain: model.companyDomain,
    website_url: model.companyWebsite,
    linkedin_url: model.companyLinkedInUrl,
    industry: model.industry,
    employee_count: model.employeeCount,
    employee_count_raw: model.employeeCountRaw,
    estimated_revenue: model.estimatedRevenue,
    location: model.location,
    page_url: model.pageUrl,
    page_title: model.pageTitle,
    page_views: model.pageViews,
    repeat_visit: model.isRepeatVisit,
  };

  let syncId = existing?.id as string | undefined;

  if (!syncId) {
    const { data: created, error: createError } = await supabase
      .from("clay_company_syncs")
      .insert({
        organization_id: organizationId,
        company_id: visit.company_id,
        visit_id: visit.id,
        status: "pending",
        request_payload: companyPayload,
        synced_by: userId,
      })
      .select("id")
      .single();

    if (createError || !created) {
      console.error("Could not create Clay company sync:", createError);
      redirect(
        visitorUrl(visitId, "error", "Company Clay sync could not be created."),
      );
    }

    syncId = created.id as string;
  } else {
    const { error: updateError } = await supabase
      .from("clay_company_syncs")
      .update({
        visit_id: visit.id,
        status: "pending",
        request_payload: companyPayload,
        response_payload: {},
        error_message: null,
        synced_by: userId,
      })
      .eq("organization_id", organizationId)
      .eq("id", syncId);

    if (updateError) {
      console.error("Could not prepare Clay company sync:", updateError);
      redirect(
        visitorUrl(visitId, "error", "Company Clay sync could not be prepared."),
      );
    }
  }

  try {
    const result = await postClayWebhook("companies", companyPayload);
    const syncedAt = new Date().toISOString();

    await supabase
      .from("clay_company_syncs")
      .update({
        status: "synced",
        response_payload: {
          http_status: result.status,
          body: result.body,
        },
        error_message: null,
        synced_at: syncedAt,
      })
      .eq("organization_id", organizationId)
      .eq("id", syncId);

    await supabase.from("activities").insert({
      organization_id: organizationId,
      company_id: visit.company_id,
      lead_id: visit.lead_id,
      actor_user_id: userId,
      activity_type: "clay.company_synced",
      title: `${model.companyName} synced to Clay Companies`,
      description:
        "Company visitor data was sent to the Clay company intake route.",
      metadata: {
        clay_company_sync_id: syncId,
        linkedin_available: Boolean(model.companyLinkedInUrl),
      },
    });

    await supabase.from("integration_connections").upsert(
      {
        organization_id: organizationId,
        provider: "clay",
        status: "connected",
        last_synced_at: syncedAt,
        config: { ingestion_method: "rb2b_single_webhook" },
      },
      { onConflict: "organization_id,provider" },
    );

    revalidatePath(`/visitors/${visitId}`);
    revalidatePath("/visitors");
    revalidatePath("/activity");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Clay company sync failed.";

    await supabase
      .from("clay_company_syncs")
      .update({
        status: "failed",
        error_message: message,
      })
      .eq("organization_id", organizationId)
      .eq("id", syncId);

    console.error("Clay company sync failed:", error);
    revalidatePath(`/visitors/${visitId}`);
    redirect(visitorUrl(visitId, "error", message));
  }

  redirect(
    visitorUrl(
      visitId,
      "success",
      "Company synced to Clay Companies.",
    ),
  );
}

export async function approveTargetAndSyncClay(formData: FormData) {
  const visitId = String(formData.get("visitId") ?? "").trim();
  const analysisId = String(formData.get("analysisId") ?? "").trim();

  if (!visitId || !analysisId) redirect("/visitors");

  const {
    supabase,
    userId,
    organizationId,
    visit,
    model,
  } = await getContext(visitId);

  const { data: analysis, error: analysisError } = await supabase
    .from("lead_analyses")
    .select(
      "id, lead_id, score, classification, summary, recommended_angle, created_at",
    )
    .eq("organization_id", organizationId)
    .eq("id", analysisId)
    .eq("lead_id", visit.lead_id)
    .limit(1)
    .maybeSingle();

  if (analysisError || !analysis) {
    redirect(
      visitorUrl(
        visitId,
        "error",
        "The AI analysis could not be loaded for target approval.",
      ),
    );
  }

  const { data: existingSync, error: existingSyncError } = await supabase
    .from("clay_target_syncs")
    .select(
      "id, target_status, person_status, company_status, approved_at, synced_at",
    )
    .eq("organization_id", organizationId)
    .eq("lead_id", visit.lead_id)
    .limit(1)
    .maybeSingle();

  if (existingSyncError) {
    console.error("Could not load existing Clay target sync:", existingSyncError);
    redirect(visitorUrl(visitId, "error", "Clay sync status could not be loaded."));
  }

  if (claySyncReady(existingSync)) {
    redirect(
      visitorUrl(
        visitId,
        "success",
        "This target is already approved and synced to Clay.",
      ),
    );
  }

  const approvedAt = existingSync?.approved_at ?? new Date().toISOString();
  const leadRecord = firstRelation(visit.leads);

  const personPayload: Record<string, unknown> = {
    dashboard_lead_id: visit.lead_id,
    dashboard_company_id: visit.company_id,
    dashboard_visit_id: visit.id,
    source: "rb2b_dashboard",
    approved_target: true,
    approved_at: approvedAt,
    first_name: leadRecord?.first_name ?? null,
    last_name: leadRecord?.last_name ?? null,
    full_name: model.personName,
    job_title: model.jobTitle,
    email: model.email,
    linkedin_url: model.personLinkedInUrl,
    location: model.location,
    company_name: model.companyName,
    company_domain: model.companyDomain,
    company_website: model.companyWebsite,
    company_linkedin_url: model.companyLinkedInUrl,
    industry: model.industry,
    employee_count: model.employeeCount,
    employee_count_raw: model.employeeCountRaw,
    estimated_revenue: model.estimatedRevenue,
    page_url: model.pageUrl,
    page_title: model.pageTitle,
    page_views: model.pageViews,
    repeat_visit: model.isRepeatVisit,
    ai_score: analysis.score,
    ai_classification: analysis.classification,
    ai_summary: analysis.summary,
    recommended_angle: analysis.recommended_angle,
    analysis_id: analysis.id,
    analysis_created_at: analysis.created_at,
  };

  const companyPayload: Record<string, unknown> = {
    dashboard_company_id: visit.company_id,
    source: "rb2b_dashboard",
    approved_target: true,
    approved_at: approvedAt,
    company_name: model.companyName,
    domain: model.companyDomain,
    website_url: model.companyWebsite,
    linkedin_url: model.companyLinkedInUrl,
    industry: model.industry,
    employee_count: model.employeeCount,
    employee_count_raw: model.employeeCountRaw,
    estimated_revenue: model.estimatedRevenue,
    location: model.location,
    approved_person_lead_id: visit.lead_id,
    ai_score: analysis.score,
    ai_classification: analysis.classification,
  };

  let syncId = existingSync?.id as string | undefined;

  if (!syncId) {
    const { data: created, error: createError } = await supabase
      .from("clay_target_syncs")
      .insert({
        organization_id: organizationId,
        lead_id: visit.lead_id,
        company_id: visit.company_id,
        analysis_id: analysis.id,
        visit_id: visit.id,
        target_status: "approved",
        person_status: "pending",
        company_status: visit.company_id ? "pending" : "skipped",
        person_request: personPayload,
        company_request: visit.company_id ? companyPayload : {},
        approved_by: userId,
        approved_at: approvedAt,
      })
      .select("id")
      .single();

    if (createError || !created) {
      console.error("Could not create Clay target sync:", createError);
      redirect(visitorUrl(visitId, "error", "Target approval could not be saved."));
    }

    syncId = created.id as string;

    const { error: activityError } = await supabase.from("activities").insert({
      organization_id: organizationId,
      lead_id: visit.lead_id,
      company_id: visit.company_id,
      actor_user_id: userId,
      activity_type: "target.approved",
      title: `${model.displayName} approved as an outbound target`,
      description: "Human approval recorded. Clay People/Companies sync started.",
      metadata: {
        analysis_id: analysis.id,
        score: analysis.score,
        classification: analysis.classification,
      },
    });

    if (activityError) {
      console.error("Could not record target approval activity:", activityError);
    }
  } else {
    const { error: updateError } = await supabase
      .from("clay_target_syncs")
      .update({
        target_status: "approved",
        company_id: visit.company_id,
        analysis_id: analysis.id,
        visit_id: visit.id,
        person_request: personPayload,
        company_request: visit.company_id ? companyPayload : {},
        approved_by: userId,
        approved_at: approvedAt,
        error_message: null,
      })
      .eq("organization_id", organizationId)
      .eq("id", syncId);

    if (updateError) {
      console.error("Could not update Clay target sync:", updateError);
      redirect(visitorUrl(visitId, "error", "Target approval could not be updated."));
    }
  }

  // Target approval means the lead is qualified. Outreach approval remains a later step.
  const { error: leadStatusError } = await supabase
    .from("leads")
    .update({ status: "qualified" })
    .eq("organization_id", organizationId)
    .eq("id", visit.lead_id);

  if (leadStatusError) {
    console.error("Could not mark target as qualified:", leadStatusError);
  }

  let companyStatus = existingSync?.company_status ?? (visit.company_id ? "pending" : "skipped");
  let personStatus = existingSync?.person_status ?? "pending";
  const errors: string[] = [];

  if (visit.company_id && companyStatus !== "synced") {
    try {
      const result = await postClayWebhook("companies", companyPayload);
      companyStatus = "synced";
      await supabase
        .from("clay_target_syncs")
        .update({
          company_status: "synced",
          company_response: { http_status: result.status, body: result.body },
          error_message: null,
        })
        .eq("organization_id", organizationId)
        .eq("id", syncId);
    } catch (error) {
      companyStatus = "failed";
      const message = error instanceof Error ? error.message : "Clay company sync failed.";
      errors.push(message);
      await supabase
        .from("clay_target_syncs")
        .update({ company_status: "failed", error_message: message })
        .eq("organization_id", organizationId)
        .eq("id", syncId);
    }
  }

  if (personStatus !== "synced") {
    try {
      const result = await postClayWebhook("people", personPayload);
      personStatus = "synced";
      await supabase
        .from("clay_target_syncs")
        .update({
          person_status: "synced",
          person_response: { http_status: result.status, body: result.body },
          error_message: errors.length ? errors.join(" | ") : null,
        })
        .eq("organization_id", organizationId)
        .eq("id", syncId);
    } catch (error) {
      personStatus = "failed";
      const message = error instanceof Error ? error.message : "Clay people sync failed.";
      errors.push(message);
      await supabase
        .from("clay_target_syncs")
        .update({ person_status: "failed", error_message: errors.join(" | ") })
        .eq("organization_id", organizationId)
        .eq("id", syncId);
    }
  }

  const ready =
    personStatus === "synced" &&
    (companyStatus === "synced" || companyStatus === "skipped");

  if (ready) {
    const syncedAt = new Date().toISOString();
    await supabase
      .from("clay_target_syncs")
      .update({ synced_at: syncedAt, error_message: null })
      .eq("organization_id", organizationId)
      .eq("id", syncId);

    await supabase.from("activities").insert({
      organization_id: organizationId,
      lead_id: visit.lead_id,
      company_id: visit.company_id,
      actor_user_id: userId,
      activity_type: "clay.target_synced",
      title: `${model.displayName} synced to Clay`,
      description: visit.company_id
        ? "Approved person synced to Clay People and their company synced to Clay Companies."
        : "Approved person synced to Clay People.",
      metadata: {
        clay_sync_id: syncId,
        person_status: personStatus,
        company_status: companyStatus,
      },
    });

    await supabase.from("integration_connections").upsert(
      {
        organization_id: organizationId,
        provider: "clay",
        status: "connected",
        last_synced_at: syncedAt,
        config: { ingestion_method: "approved_target_webhooks" },
      },
      { onConflict: "organization_id,provider" },
    );

    revalidatePath(`/visitors/${visitId}`);
    revalidatePath("/targets");
    revalidatePath("/outreach");
    redirect(
      visitorUrl(
        visitId,
        "success",
        visit.company_id
          ? "Target approved. Person and company synced to Clay."
          : "Target approved. Person synced to Clay.",
      ),
    );
  }

  await supabase.from("integration_connections").upsert(
    {
      organization_id: organizationId,
      provider: "clay",
      status: "error",
      config: {
        ingestion_method: "approved_target_webhooks",
        last_error: errors.join(" | "),
      },
    },
    { onConflict: "organization_id,provider" },
  );

  revalidatePath(`/visitors/${visitId}`);
  redirect(
    visitorUrl(
      visitId,
      "error",
      `Target approved, but Clay sync is incomplete. Person: ${personStatus}. Company: ${companyStatus}. You can retry from this page.`,
    ),
  );
}

export async function generateOutreach(formData: FormData) {
  const visitId = String(formData.get("visitId") ?? "").trim();
  if (!visitId) redirect("/visitors");

  const {
    supabase,
    userId,
    organizationId,
    visit,
    model,
    targetContext,
  } = await getContext(visitId);

  const { data: latestAnalysis, error: analysisError } = await supabase
    .from("lead_analyses")
    .select(
      "id, score, classification, summary, positive_signals, concerns, recommended_angle",
    )
    .eq("organization_id", organizationId)
    .eq("lead_id", visit.lead_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (analysisError) {
    console.error("Could not load latest analysis:", analysisError);
    redirect(visitorUrl(visitId, "error", "The target analysis could not be loaded."));
  }

  if (!latestAnalysis) {
    redirect(
      visitorUrl(
        visitId,
        "error",
        "Analyse the target before generating outreach.",
      ),
    );
  }

  const { data: claySync, error: claySyncError } = await supabase
    .from("clay_target_syncs")
    .select("target_status, person_status, company_status")
    .eq("organization_id", organizationId)
    .eq("lead_id", visit.lead_id)
    .limit(1)
    .maybeSingle();

  if (claySyncError) {
    console.error("Could not load Clay target approval:", claySyncError);
    redirect(visitorUrl(visitId, "error", "Clay target approval could not be loaded."));
  }

  if (!claySyncReady(claySync)) {
    redirect(
      visitorUrl(
        visitId,
        "error",
        "Approve the target and complete the Clay People/Companies sync before generating outreach.",
      ),
    );
  }

  try {
    const outreach = await runOutreachGeneration({
      context: targetContext,
      analysis: {
        score: latestAnalysis.score as number,
        classification: latestAnalysis.classification as
          | "strong_target"
          | "review"
          | "low_priority",
        summary: latestAnalysis.summary as string,
        positive_signals: Array.isArray(latestAnalysis.positive_signals)
          ? (latestAnalysis.positive_signals as string[])
          : [],
        concerns: Array.isArray(latestAnalysis.concerns)
          ? (latestAnalysis.concerns as string[])
          : [],
        recommended_angle: latestAnalysis.recommended_angle as string,
      },
    });

    const { data: draft, error: draftError } = await supabase
      .from("outreach_drafts")
      .insert({
        organization_id: organizationId,
        lead_id: visit.lead_id,
        visit_id: visit.id,
        analysis_id: latestAnalysis.id,
        status: "draft",
        email_subject: outreach.email_subject,
        email_body: outreach.email_body,
        linkedin_connection_note: outreach.linkedin_connection_note,
        linkedin_followup: outreach.linkedin_followup,
        model: outreach.model,
        prompt_version: outreach.promptVersion,
        created_by: userId,
      })
      .select("id")
      .single();

    if (draftError || !draft) {
      throw draftError ?? new Error("Could not save outreach draft.");
    }

    const { error: activityError } = await supabase
      .from("activities")
      .insert({
        organization_id: organizationId,
        lead_id: visit.lead_id,
        company_id: visit.company_id,
        actor_user_id: userId,
        activity_type: "ai.outreach_generated",
        title: `Outreach draft generated for ${model.displayName}`,
        description: "Email and LinkedIn drafts are ready for human review.",
        metadata: {
          draft_id: draft.id,
          analysis_id: latestAnalysis.id,
          prompt_version: outreach.promptVersion,
        },
      });

    if (activityError) {
      console.error("Could not record outreach generation activity:", activityError);
    }
  } catch (error) {
    console.error("Outreach generation failed:", error);
    const message =
      error instanceof Error ? error.message : "Outreach generation failed.";
    redirect(visitorUrl(visitId, "error", message));
  }

  revalidatePath(`/visitors/${visitId}`);
  redirect(visitorUrl(visitId, "success", "Outreach draft generated."));
}

function draftFields(formData: FormData) {
  return {
    email_subject: String(formData.get("emailSubject") ?? "").trim(),
    email_body: String(formData.get("emailBody") ?? "").trim(),
    linkedin_connection_note: String(
      formData.get("linkedinConnectionNote") ?? "",
    ).trim(),
    linkedin_followup: String(formData.get("linkedinFollowup") ?? "").trim(),
  };
}

async function getEditableDraft(params: {
  visitId: string;
  draftId: string;
}) {
  const context = await getContext(params.visitId);

  const { data: draft, error } = await context.supabase
    .from("outreach_drafts")
    .select("id, lead_id, status")
    .eq("organization_id", context.organizationId)
    .eq("id", params.draftId)
    .limit(1)
    .maybeSingle();

  if (error || !draft) {
    redirect(visitorUrl(params.visitId, "error", "The outreach draft could not be loaded."));
  }

  if (draft.lead_id !== context.visit.lead_id) {
    redirect(visitorUrl(params.visitId, "error", "The outreach draft does not belong to this lead."));
  }

  return { ...context, draft };
}

export async function saveOutreachDraft(formData: FormData) {
  const visitId = String(formData.get("visitId") ?? "").trim();
  const draftId = String(formData.get("draftId") ?? "").trim();

  if (!visitId || !draftId) redirect("/visitors");

  const fields = draftFields(formData);

  if (
    !fields.email_subject ||
    !fields.email_body ||
    !fields.linkedin_connection_note ||
    !fields.linkedin_followup
  ) {
    redirect(visitorUrl(visitId, "error", "All outreach fields are required."));
  }

  const { supabase, organizationId } = await getEditableDraft({
    visitId,
    draftId,
  });

  const { error } = await supabase
    .from("outreach_drafts")
    .update({
      ...fields,
      status: "draft",
      approved_by: null,
      approved_at: null,
    })
    .eq("organization_id", organizationId)
    .eq("id", draftId);

  if (error) {
    console.error("Could not save outreach draft:", error);
    redirect(visitorUrl(visitId, "error", "The outreach draft could not be saved."));
  }

  revalidatePath(`/visitors/${visitId}`);
  redirect(visitorUrl(visitId, "success", "Outreach changes saved."));
}

export async function approveOutreachDraft(formData: FormData) {
  const visitId = String(formData.get("visitId") ?? "").trim();
  const draftId = String(formData.get("draftId") ?? "").trim();

  if (!visitId || !draftId) redirect("/visitors");

  const fields = draftFields(formData);

  if (
    !fields.email_subject ||
    !fields.email_body ||
    !fields.linkedin_connection_note ||
    !fields.linkedin_followup
  ) {
    redirect(visitorUrl(visitId, "error", "All outreach fields are required before approval."));
  }

  const {
    supabase,
    userId,
    organizationId,
    visit,
    model,
  } = await getEditableDraft({ visitId, draftId });

  const approvedAt = new Date().toISOString();

  const { error: draftError } = await supabase
    .from("outreach_drafts")
    .update({
      ...fields,
      status: "approved",
      approved_by: userId,
      approved_at: approvedAt,
    })
    .eq("organization_id", organizationId)
    .eq("id", draftId);

  if (draftError) {
    console.error("Could not approve outreach draft:", draftError);
    redirect(visitorUrl(visitId, "error", "The outreach draft could not be approved."));
  }

  const { error: leadError } = await supabase
    .from("leads")
    .update({ status: "approved" })
    .eq("organization_id", organizationId)
    .eq("id", visit.lead_id);

  if (leadError) {
    console.error("Could not update lead approval status:", leadError);
  }

  const { error: activityError } = await supabase
    .from("activities")
    .insert({
      organization_id: organizationId,
      lead_id: visit.lead_id,
      company_id: visit.company_id,
      actor_user_id: userId,
      activity_type: "outreach.approved",
      title: `Outreach approved for ${model.displayName}`,
      description: "The email and LinkedIn copy was approved for campaign launch.",
      metadata: { draft_id: draftId, approved_at: approvedAt },
    });

  if (activityError) {
    console.error("Could not record outreach approval activity:", activityError);
  }

  revalidatePath(`/visitors/${visitId}`);
  revalidatePath("/dashboard");
  redirect(
    visitorUrl(
      visitId,
      "success",
      "Outreach approved. Clay and HeyReach launch comes in the next milestone.",
    ),
  );
}
