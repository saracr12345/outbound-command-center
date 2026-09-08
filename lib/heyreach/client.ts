const HEYREACH_BASE_URL =
  process.env.HEYREACH_API_BASE_URL ?? "https://api.heyreach.io/api/public";

export type HeyReachCampaign = {
  id: number;
  name: string;
  creationTime?: string | null;
  linkedInUserListName?: string | null;
  linkedInUserListId?: number | null;
  campaignAccountIds?: number[];
  status?: string | null;
  progressStats?: {
    totalUsers?: number;
    totalUsersInProgress?: number;
    totalUsersPending?: number;
    totalUsersFinished?: number;
    totalUsersFailed?: number;
  } | null;
};

type HeyReachCampaignListResponse = {
  totalCount: number;
  items: HeyReachCampaign[];
};

export type HeyReachAddLeadInput = {
  campaignId: number;
  firstName: string;
  lastName: string;
  profileUrl: string;
  location?: string | null;
  companyName?: string | null;
  position?: string | null;
  emailAddress?: string | null;
  customUserFields?: Array<{ name: string; value: string }>;
};

export type HeyReachAddLeadResult = {
  addedLeadsCount: number;
  updatedLeadsCount: number;
  failedLeadsCount: number;
};

function getApiKey(): string {
  const key = process.env.HEYREACH_API_KEY;
  if (!key) throw new Error("HEYREACH_API_KEY is not configured.");
  return key;
}

async function heyReachRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${HEYREACH_BASE_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "X-API-KEY": getApiKey(),
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });

  const raw = await response.text();
  let parsed: unknown = null;

  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
  }

  if (!response.ok) {
    const detail =
      typeof parsed === "object" && parsed !== null
        ? JSON.stringify(parsed)
        : String(parsed ?? "");
    throw new Error(
      `HeyReach request failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  return parsed as T;
}

export async function checkHeyReachApiKey(): Promise<boolean> {
  await heyReachRequest<null>("/auth/CheckApiKey", { method: "GET" });
  return true;
}

export async function listHeyReachCampaigns(): Promise<HeyReachCampaignListResponse> {
  const result = await heyReachRequest<HeyReachCampaignListResponse>(
    "/campaign/GetAll",
    {
      method: "POST",
      body: JSON.stringify({ offset: 0, limit: 100 }),
    },
  );

  return {
    totalCount: Number(result?.totalCount ?? 0),
    items: Array.isArray(result?.items) ? result.items : [],
  };
}

export function isHeyReachCampaignUnsafeToActivate(status: string | null | undefined) {
  const normalized = String(status ?? "").trim().toUpperCase();
  return [
    "DRAFT",
    "PAUSED",
    "FINISHED",
    "FAILED",
    "CANCELED",
    "CANCELLED",
  ].includes(normalized);
}

export async function addLeadToHeyReachCampaign(
  input: HeyReachAddLeadInput,
): Promise<HeyReachAddLeadResult> {
  const lead: Record<string, unknown> = {
    firstName: input.firstName,
    lastName: input.lastName,
    profileUrl: input.profileUrl,
    customUserFields: input.customUserFields ?? [],
  };

  if (input.location) lead.location = input.location;
  if (input.companyName) lead.companyName = input.companyName;
  if (input.position) lead.position = input.position;
  if (input.emailAddress) lead.emailAddress = input.emailAddress;

  return heyReachRequest<HeyReachAddLeadResult>(
    "/campaign/AddLeadsToCampaignV2",
    {
      method: "POST",
      body: JSON.stringify({
        campaignId: input.campaignId,
        accountLeadPairs: [{ lead }],
      }),
    },
  );
}
