import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function getDashboardContext() {
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
    redirect(
      "/dashboard?error=Your%20team%20membership%20could%20not%20be%20loaded.",
    );
  }

  const organizationId = membership.organization_id as string;
  const { data: organization } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .single();

  return {
    supabase,
    userId,
    organizationId,
    organizationName: organization?.name ?? "T3 Consultants",
    email: typeof claims?.email === "string" ? claims.email : "Team member",
    role: String(membership.role ?? "member"),
  };
}
