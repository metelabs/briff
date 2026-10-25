import { getDb } from "@/lib/db/client";
import { githubAppConfig } from "@/lib/github/config";
import { enqueueGithubScan } from "@/lib/github/flow";
import {
  findInstallation,
  forgetInstallation,
  removeInstallationRepos,
  setInstallationSuspended,
} from "@/lib/github/installations";
import { verifyWebhookSignature } from "@/lib/github/signature";
import { MAX_WEBHOOK_BYTES, planWebhook, type WebhookPlan } from "@/lib/github/webhook";
import { log } from "@/lib/log";

/** The raw body, or null once it passes `limit` bytes (read stops there). */
async function readCapped(request: Request, limit: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    body.set(c, offset);
    offset += c.byteLength;
  }
  return body;
}

async function act(plan: WebhookPlan): Promise<string> {
  const db = getDb();
  switch (plan.kind) {
    case "ignore":
      return `ignored: ${plan.reason}`;
    case "installation-deleted":
      return (await forgetInstallation(db, plan.installationId))
        ? "forgotten"
        : "unknown installation";
    case "installation-suspended":
      return (await setInstallationSuspended(db, plan.installationId, plan.suspended))
        ? plan.suspended
          ? "suspended"
          : "unsuspended"
        : "unknown installation";
    case "scan": {
      const row = await findInstallation(db, plan.installationId);
      if (!row) return "unknown installation";
      if (row.suspendedAt) return "suspended";
      const job = await enqueueGithubScan(db, {
        installationId: plan.installationId,
        repos: plan.repos ?? undefined,
        force: plan.reason === "repositories added" || undefined,
      });
      return `scan queued (${plan.reason})${job.created ? "" : ", already pending"}`;
    }
    case "remove": {
      const row = await findInstallation(db, plan.installationId);
      if (!row) return "unknown installation";
      const removed = await removeInstallationRepos(db, row, plan.repos);
      return `removed ${removed.length}`;
    }
  }
}

// GitHub App webhook (docs/GITHUB-APP.md): size cap, then the HMAC signature on the raw
// bytes, then parsing; work is queued and the answer is quick (202).
export async function POST(request: Request): Promise<Response> {
  const config = githubAppConfig();
  if (!config) return Response.json({ error: "GitHub App not configured." }, { status: 503 });
  const body = await readCapped(request, MAX_WEBHOOK_BYTES);
  if (!body) return Response.json({ error: "Payload too large." }, { status: 413 });
  if (
    !verifyWebhookSignature(config.webhookSecret, body, request.headers.get("x-hub-signature-256"))
  ) {
    return Response.json({ error: "Invalid signature." }, { status: 401 });
  }
  const event = request.headers.get("x-github-event") ?? "";
  const delivery = request.headers.get("x-github-delivery") ?? "";
  let plans: WebhookPlan[];
  try {
    plans = planWebhook(event, JSON.parse(new TextDecoder().decode(body)));
  } catch (err) {
    log.warn({ err, event, delivery }, "github webhook: unreadable payload");
    return Response.json({ error: "Unreadable payload." }, { status: 400 });
  }
  const results: string[] = [];
  for (const plan of plans) results.push(await act(plan));
  log.info({ event, delivery, results }, "github webhook");
  return Response.json({ ok: true, results }, { status: 202 });
}
