"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function messageUrl(
  kind: "error" | "success",
  message: string,
): string {
  return `/dashboard?${kind}=${encodeURIComponent(message)}`;
}

async function getAuthenticatedContext() {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  const userId =
    typeof claimsData?.claims?.sub === "string"
      ? claimsData.claims.sub
      : null;

  if (claimsError || !userId) {
    redirect("/login");
  }

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    console.error("Could not load membership:", membershipError);
    redirect(
      messageUrl(
        "error",
        "Your team membership could not be loaded.",
      ),
    );
  }

  if (!membership) {
    redirect(
      messageUrl(
        "error",
        "Your login is not attached to an organization yet.",
      ),
    );
  }

  return {
    supabase,
    userId,
    organizationId: membership.organization_id as string,
    role: membership.role as string,
  };
}

export async function addLead(formData: FormData) {
  const { supabase, userId, organizationId } =
    await getAuthenticatedContext();

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const companyName = String(formData.get("companyName") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const jobTitle = String(formData.get("jobTitle") ?? "").trim();
  const linkedinUrl = String(
    formData.get("linkedinUrl") ?? "",
  ).trim();

  if (!firstName && !lastName && !email && !linkedinUrl) {
    redirect(
      messageUrl(
        "error",
        "Add a name, email address, or LinkedIn URL.",
      ),
    );
  }

  if (email && !email.includes("@")) {
    redirect(
      messageUrl("error", "Enter a valid email address."),
    );
  }

  let companyId: string | null = null;

  if (companyName) {
    const { data: existingCompany, error: lookupError } =
      await supabase
        .from("companies")
        .select("id")
        .eq("organization_id", organizationId)
        .ilike("name", companyName)
        .limit(1)
        .maybeSingle();

    if (lookupError) {
      console.error("Company lookup failed:", lookupError);
      redirect(
        messageUrl("error", "The company could not be checked."),
      );
    }

    if (existingCompany) {
      companyId = existingCompany.id as string;
    } else {
      const { data: createdCompany, error: companyError } =
        await supabase
          .from("companies")
          .insert({
            organization_id: organizationId,
            name: companyName,
          })
          .select("id")
          .single();

      if (companyError || !createdCompany) {
        console.error("Company creation failed:", companyError);
        redirect(
          messageUrl("error", "The company could not be created."),
        );
      }

      companyId = createdCompany.id as string;
    }
  }

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .insert({
      organization_id: organizationId,
      company_id: companyId,
      first_name: firstName || null,
      last_name: lastName || null,
      job_title: jobTitle || null,
      email: email || null,
      linkedin_url: linkedinUrl || null,
      source: "manual",
      status: "new",
      created_by: userId,
    })
    .select("id")
    .single();

  if (leadError || !lead) {
    console.error("Lead creation failed:", leadError);
    redirect(
      messageUrl(
        "error",
        leadError?.message ?? "The lead could not be created.",
      ),
    );
  }

  const displayName =
    [firstName, lastName].filter(Boolean).join(" ") ||
    email ||
    "New lead";

  const { error: activityError } = await supabase
    .from("activities")
    .insert({
      organization_id: organizationId,
      lead_id: lead.id,
      actor_user_id: userId,
      activity_type: "lead.created",
      title: `${displayName} was added`,
      description: companyName
        ? `Manual lead added for ${companyName}.`
        : "Manual lead added.",
    });

  if (activityError) {
    // The lead itself was successfully created, so do not fail the action.
    console.error("Activity creation failed:", activityError);
  }

  revalidatePath("/dashboard");
  redirect(messageUrl("success", `${displayName} was added.`));
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();

  revalidatePath("/", "layout");
  redirect("/login");
}
