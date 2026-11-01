import { after } from "next/server";

import { getDb } from "@/lib/db/client";
import { handlePaddleEvent, MAX_WEBHOOK_BYTES, verifyPaddleEvent } from "@/lib/billing/webhook";
import { getEnv } from "@/lib/env";
import { readCapped } from "@/lib/http/read-capped";
import { log } from "@/lib/log";
import { sendOpsAlert } from "@/lib/ops/alerts";

function alertAdmin(jobType: string, headline: string, summary: string, error: string | null) {
  // After the response: SMTP must not hold up Paddle's 5-second delivery window.
  after(async () => {
    try {
      await sendOpsAlert(
        getDb(),
        { kind: "failed", jobType, at: new Date(), headline, summary, error },
        log
      );
    } catch (err) {
      log.error({ err, jobType }, "billing webhook: ops alert failed");
    }
  });
}

// Paddle notification destination (docs/BILLING.md): size cap, signature on the raw body, then
// the event is stored and processed once (BillingEvent). Any non-2xx makes Paddle retry.
export async function POST(request: Request): Promise<Response> {
  const env = getEnv();
  const secret = env.PADDLE_WEBHOOK_SECRET;
  if (!env.BRIFF_CLOUD || !secret) {
    return Response.json({ error: "Billing webhooks are not configured." }, { status: 503 });
  }
  const signature = request.headers.get("paddle-signature") ?? "";
  const body = await readCapped(request, MAX_WEBHOOK_BYTES);
  if (!body) return Response.json({ error: "Payload too large." }, { status: 413 });
  const raw = new TextDecoder().decode(body);
  if (!signature || !raw) {
    return Response.json({ error: "Missing signature or body." }, { status: 400 });
  }
  const event = await verifyPaddleEvent(raw, secret, signature);
  if (!event) {
    log.warn({}, "billing webhook: signature verification failed");
    alertAdmin(
      "paddle-webhook:signature",
      "Billing webhook: signature check failed",
      "A request to /api/billing/paddle did not verify against PADDLE_WEBHOOK_SECRET. If it came from Paddle, the secret in the environment does not match the notification destination; Paddle retries, so fixing the secret recovers the events.",
      null
    );
    return Response.json({ error: "Invalid signature." }, { status: 401 });
  }
  try {
    const result = await handlePaddleEvent(getDb(), event, JSON.parse(raw), {
      env: env.PADDLE_ENV,
      authSecret: env.BETTER_AUTH_SECRET,
    });
    log.info({ eventId: event.eventId, type: event.eventType, result }, "billing webhook");
    return Response.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(
      { eventId: event.eventId, type: event.eventType, error: message },
      "billing webhook: processing failed"
    );
    alertAdmin(
      "paddle-webhook:processing",
      `Billing webhook: ${event.eventType} failed`,
      `Event ${event.eventId} could not be processed; Paddle retries it. The error is stored on the BillingEvent row.`,
      message
    );
    return Response.json({ error: "Processing failed." }, { status: 500 });
  }
}
