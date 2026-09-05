"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  buildVisitorViewModel,
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
    location: model.location,
    companyName: model.companyName,
    companyDomain: model.companyDomain,
    companyWebsite: model.companyWebsite,
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

    const { error: leadUpdateError } = await supabase
      .from("leads")
      .update({ icp_score: analysis.score })
      .eq("organization_id", organizationId)
      .eq("id", visit.lead_id);

    if (leadUpdateError) {
      console.error("Could not update lead ICP score:", leadUpdateError);
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
