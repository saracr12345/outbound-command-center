import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listHeyReachCampaigns } from "@/lib/heyreach/client";

export async function GET() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId =
    typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "No organization membership" }, { status: 403 });
  }

  try {
    const result = await listHeyReachCampaigns();
    return NextResponse.json({
      campaigns: result.items.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status ?? null,
        progressStats: campaign.progressStats ?? null,
      })),
      totalCount: result.totalCount,
    });
  } catch (error) {
    console.error("Could not load HeyReach campaigns:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not load HeyReach campaigns.",
      },
      { status: 502 },
    );
  }
}
