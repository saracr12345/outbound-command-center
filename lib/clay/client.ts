type ClayWebhookKind = "people" | "companies";

type ClayWebhookResponse = {
  status: number;
  body: unknown;
};

function getWebhookConfig() {
  const url = process.env.CLAY_RB2B_WEBHOOK_URL;

  if (!url) {
    throw new Error("CLAY_RB2B_WEBHOOK_URL is not configured.");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("CLAY_RB2B_WEBHOOK_URL is not a valid URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("CLAY_RB2B_WEBHOOK_URL must use HTTPS.");
  }

  const authHeaderName =
    process.env.CLAY_RB2B_WEBHOOK_AUTH_HEADER_NAME?.trim();
  const authToken = process.env.CLAY_RB2B_WEBHOOK_AUTH_TOKEN?.trim();

  return { url, authHeaderName, authToken };
}

export async function postClayWebhook(
  kind: ClayWebhookKind,
  payload: Record<string, unknown>,
): Promise<ClayWebhookResponse> {
  const { url, authHeaderName, authToken } = getWebhookConfig();

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  if (authHeaderName && authToken) {
    headers[authHeaderName] = authToken;
  }

  // We deliberately use ONE Clay webhook intake table.
  // Clay routes the row using record_type:
  //   person  -> People from RB2B
  //   company -> Companies from RB2B (Manual)
  const recordType = kind === "people" ? "person" : "company";

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...payload,
      record_type: recordType,
    }),
    cache: "no-store",
  });

  const raw = await response.text();
  let body: unknown = null;

  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
  }

  if (!response.ok) {
    const detail =
      typeof body === "object" && body !== null
        ? JSON.stringify(body)
        : String(body ?? "");

    throw new Error(
      `Clay ${recordType} webhook failed (${response.status})${
        detail ? `: ${detail}` : ""
      }`,
    );
  }

  return { status: response.status, body };
}
