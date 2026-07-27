import {
    createHmac,
    timingSafeEqual,
  } from "node:crypto";
  
  export const runtime = "nodejs";
  export const dynamic = "force-dynamic";
  
  type SlackEvent = {
    type?: string;
    subtype?: string;
    channel?: string;
    bot_id?: string;
    text?: string;
    ts?: string;
  };
  
  type SlackPayload = {
    type?: string;
    challenge?: string;
    event_id?: string;
    event?: SlackEvent;
  };
  
  function safeCompare(
    receivedValue: string,
    expectedValue: string,
  ): boolean {
    const received = Buffer.from(receivedValue);
    const expected = Buffer.from(expectedValue);
  
    if (received.length !== expected.length) {
      return false;
    }
  
    return timingSafeEqual(received, expected);
  }
  
  function verifySlackRequest(
    rawBody: string,
    timestamp: string,
    receivedSignature: string,
  ): boolean {
    const signingSecret =
      process.env.SLACK_SIGNING_SECRET;
  
    if (!signingSecret) {
      console.error(
        "SLACK_SIGNING_SECRET is not configured.",
      );
  
      return false;
    }
  
    const timestampNumber = Number(timestamp);
  
    if (!Number.isFinite(timestampNumber)) {
      return false;
    }
  
    // Reject requests older than five minutes.
    const currentTimestamp = Math.floor(
      Date.now() / 1000,
    );
  
    if (
      Math.abs(currentTimestamp - timestampNumber) >
      60 * 5
    ) {
      return false;
    }
  
    const signatureBaseString =
      `v0:${timestamp}:${rawBody}`;
  
    const expectedSignature =
      `v0=${createHmac("sha256", signingSecret)
        .update(signatureBaseString)
        .digest("hex")}`;
  
    return safeCompare(
      receivedSignature,
      expectedSignature,
    );
  }
  
  export async function GET() {
    return Response.json({
      ok: true,
      service: "slack-webhook",
    });
  }
  
  export async function POST(request: Request) {
    /*
     * We must read the original raw body before parsing JSON.
     * Slack calculates its signature from this exact body.
     */
    const rawBody = await request.text();
  
    const timestamp =
      request.headers.get(
        "x-slack-request-timestamp",
      ) ?? "";
  
    const signature =
      request.headers.get(
        "x-slack-signature",
      ) ?? "";
  
    const isAuthentic = verifySlackRequest(
      rawBody,
      timestamp,
      signature,
    );
  
    if (!isAuthentic) {
      console.warn(
        "Rejected request with invalid Slack signature.",
      );
  
      return Response.json(
        {
          ok: false,
          error: "invalid_signature",
        },
        {
          status: 401,
        },
      );
    }
  
    let payload: SlackPayload;
  
    try {
      payload = JSON.parse(rawBody) as SlackPayload;
    } catch {
      return Response.json(
        {
          ok: false,
          error: "invalid_json",
        },
        {
          status: 400,
        },
      );
    }
  
    /*
     * Slack sends this when we enter the Request URL
     * under Event Subscriptions.
     */
    if (
      payload.type === "url_verification" &&
      typeof payload.challenge === "string"
    ) {
      return new Response(payload.challenge, {
        status: 200,
        headers: {
          "Content-Type": "text/plain",
        },
      });
    }
  
    /*
     * For now, acknowledge real events.
     * The next milestone will parse and save RB2B messages.
     */
    if (payload.type === "event_callback") {
      console.log("Slack event received:", {
        eventId: payload.event_id,
        eventType: payload.event?.type,
        subtype: payload.event?.subtype,
        channel: payload.event?.channel,
        botId: payload.event?.bot_id,
        timestamp: payload.event?.ts,
      });
    }
  
    return Response.json({
      ok: true,
    });
  }