import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { getEnv } from "@/lib/env";
import { enqueueJobOnce } from "@/lib/jobs/queue";
import type { Logger } from "@/lib/log";
import { loadOrgLimits } from "@/lib/org-limits";
import { safeFetch, SsrfBlockedError } from "@/lib/rss/safe-fetch";
import { sha256Hex } from "@/lib/crypto";
import { loadBulletinView } from "@/pipeline/bulletin-view";
import { severityLabel, severityRank } from "@/security/plan";
import type { JobContext, JobResult } from "@/worker/types";

import {
  buildRequest,
  type DeliveryEvent,
  type DeliveryItem,
  type DeliveryTargetKind,
  testEvent,
} from "./format";
import {
  DeliveryTargetError,
  notOnPlanMessage,
  recordDeliveryResult,
  targetsAllowed,
} from "./store";

// After a bulletin is delivered and after a same-day alert email, one `deliver-target` job per
// matching target, enqueued once per (target, bulletin | alert batch) ever. The job posts
// through safeFetch (SSRF guard, pinned DNS), 10 s timeout; 3 retries with the queue's backoff.

export const DELIVERY_TIMEOUT_MS = 10_000;
export const DELIVERY_MAX_ATTEMPTS = 4;
const RESPONSE_MAX_BYTES = 16_000;

export interface PostResponse {
  status: number;
  body: string;
}

export type PostFn = (
  url: string,
  init: { body: string; headers: Record<string, string>; timeoutMs: number }
) => Promise<PostResponse>;

export const safePost: PostFn = async (url, init) => {
  const res = await safeFetch(url, {
    method: "POST",
    body: init.body,
    headers: init.headers,
    timeoutMs: init.timeoutMs,
    maxBytes: RESPONSE_MAX_BYTES,
    retries: 0,
  });
  return { status: res.status, body: res.body };
};

export type SendResult =
  { ok: true; status: number } | { ok: false; error: string; retry: boolean };

/** One POST to a target. Never throws: refused hosts and 4xx are final, the rest retryable. */
export async function sendToTarget(
  target: { kind: DeliveryTargetKind; url: string; secret: string | null },
  event: DeliveryEvent,
  deliveryId: string,
  post: PostFn = safePost
): Promise<SendResult> {
  const req = buildRequest(target, event, deliveryId);
  try {
    const res = await post(target.url, { ...req, timeoutMs: DELIVERY_TIMEOUT_MS });
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
    const snippet = res.body.replace(/\s+/g, " ").trim().slice(0, 120);
    const error = `HTTP ${res.status}${snippet ? `: ${snippet}` : ""}`;
    const retry = res.status === 408 || res.status === 429 || res.status >= 500;
    return { ok: false, error, retry };
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      return {
        ok: false,
        error: "Refused: the URL points to a private or internal address.",
        retry: false,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: /timeout/i.test(message)
        ? "No answer within 10 seconds."
        : `Could not connect: ${message}`,
      retry: true,
    };
  }
}

function baseUrl(): string {
  return getEnv().BETTER_AUTH_URL.replace(/\/$/, "");
}

async function orgRef(db: PrismaClient, orgId: string): Promise<{ id: string; name: string }> {
  return db.org.findUniqueOrThrow({ where: { id: orgId }, select: { id: true, name: true } });
}

/** The first paragraph of the bulletin summary. */
function firstParagraph(text: string): string {
  return text.split(/\n{2,}/)[0]?.trim() ?? "";
}

export async function bulletinEvent(
  db: PrismaClient,
  orgId: string,
  bulletinId: string
): Promise<DeliveryEvent | null> {
  const view = await loadBulletinView(db, orgId, bulletinId);
  if (!view || view.preview) return null;
  const base = baseUrl();
  const items: DeliveryItem[] = [
    ...view.act.map((i) => ({
      title: i.headline || i.title,
      detail: i.action || null,
      url: i.url,
      severity: null,
      repos: i.affectedRepos,
    })),
    ...view.know.map((i) => ({
      title: i.headline || i.title,
      detail: null,
      url: i.url,
      severity: null,
      repos: i.affectedRepos,
    })),
    ...view.alerts.map((a) => ({
      title: `${a.packageName}: ${a.osvIds.length} security ${a.osvIds.length === 1 ? "advisory" : "advisories"}`,
      detail: a.fixed ? `Fixed in ${a.fixed}` : null,
      url: null,
      severity: severityLabel(a.severity),
      repos: a.repos,
    })),
  ];
  return {
    type: "bulletin",
    org: await orgRef(db, orgId),
    stream: view.streamId ? { id: view.streamId, name: view.streamName ?? "" } : null,
    occurredAt: view.createdAt,
    title: view.subject || `Briff · ${view.weekLabel}`,
    summary: firstParagraph(view.summary),
    url: `${base}/b/${bulletinId}`,
    items,
  };
}

/** The alerts of one same-day batch the target's stream covers, one item per advisory. */
export async function alertEvent(
  db: PrismaClient,
  orgId: string,
  alertIds: string[],
  stream: { id: string; name: string } | null,
  occurredAt: Date
): Promise<DeliveryEvent | null> {
  const scoped = withOrg(db, orgId);
  const repoIds = stream
    ? (
        await scoped.streamRepo.findMany({
          where: { streamId: stream.id },
          select: { repoId: true },
        })
      ).map((r) => r.repoId)
    : null;
  const alerts = await scoped.alert.findMany({
    where: {
      id: { in: alertIds },
      resolvedAt: null,
      ...(repoIds ? { repoId: { in: repoIds } } : {}),
    },
    select: {
      repo: { select: { name: true } },
      advisory: {
        select: {
          osvId: true,
          summary: true,
          severity: true,
          package: { select: { name: true } },
        },
      },
    },
  });
  if (alerts.length === 0) return null;
  const groups = new Map<string, { item: DeliveryItem; rank: number }>();
  for (const a of alerts) {
    const adv = a.advisory;
    const group = groups.get(adv.osvId) ?? {
      item: {
        title: `${adv.package.name}: ${adv.osvId}`,
        detail: adv.summary || null,
        url: `https://osv.dev/vulnerability/${encodeURIComponent(adv.osvId)}`,
        severity: severityLabel(adv.severity),
        repos: [],
      },
      rank: severityRank(adv.severity),
    };
    if (!group.item.repos.includes(a.repo.name)) group.item.repos.push(a.repo.name);
    groups.set(adv.osvId, group);
  }
  const items = [...groups.values()]
    .sort((x, y) => y.rank - x.rank || x.item.title.localeCompare(y.item.title))
    .map((g) => ({ ...g.item, repos: g.item.repos.sort() }));
  const repos = new Set(alerts.map((a) => a.repo.name)).size;
  const n = items.length;
  return {
    type: "alerts",
    org: await orgRef(db, orgId),
    stream,
    occurredAt,
    title: `Briff · ${n} new security ${n === 1 ? "advisory" : "advisories"}${stream ? ` · ${stream.name}` : ""}`,
    summary: `${n === 1 ? "A critical or high advisory affects" : `${n} critical or high advisories affect`} ${repos} ${repos === 1 ? "repo" : "repos"}.`,
    url: `${baseUrl()}/alerts`,
    items,
  };
}

const payloadSchema = z.discriminatedUnion("event", [
  z.object({
    orgId: z.string(),
    targetId: z.string(),
    event: z.literal("bulletin"),
    bulletinId: z.string(),
  }),
  z.object({
    orgId: z.string(),
    targetId: z.string(),
    event: z.literal("alerts"),
    batchId: z.string(),
    alertIds: z.array(z.string()).min(1),
    occurredAt: z.iso.datetime(),
  }),
]);

type Payload = z.infer<typeof payloadSchema>;

async function enqueueFor(
  db: PrismaClient,
  targetIds: string[],
  ref: string,
  payload: (targetId: string) => Payload
): Promise<number> {
  let created = 0;
  for (const targetId of targetIds) {
    const res = await enqueueJobOnce(db, "deliver-target", {
      dedupeKey: `deliver:${targetId}:${ref}`,
      payload: payload(targetId),
      maxAttempts: DELIVERY_MAX_ATTEMPTS,
    });
    if (res.created) created++;
  }
  return created;
}

async function enabledTargets(
  db: PrismaClient,
  orgId: string,
  event: "bulletin" | "alert"
): Promise<{ id: string; streamId: string | null }[]> {
  if (!targetsAllowed(await loadOrgLimits(db, orgId))) return [];
  return withOrg(db, orgId).deliveryTarget.findMany({
    where: { enabled: true, [event]: true },
    select: { id: true, streamId: true },
  });
}

/** Called once the bulletin went out; a target gets each bulletin once, whatever re-sends. */
export async function enqueueBulletinDeliveries(
  db: PrismaClient,
  orgId: string,
  bulletin: { id: string; streamId: string | null }
): Promise<number> {
  const targets = (await enabledTargets(db, orgId, "bulletin")).filter(
    (t) => t.streamId === null || t.streamId === bulletin.streamId
  );
  return enqueueFor(
    db,
    targets.map((t) => t.id),
    bulletin.id,
    (targetId) => ({ orgId, targetId, event: "bulletin", bulletinId: bulletin.id })
  );
}

/** The batch id: the same alert set is one batch, so a retried enqueue posts nothing twice. */
export function alertBatchId(alertIds: readonly string[]): string {
  return `alerts-${sha256Hex([...alertIds].sort().join(",")).slice(0, 24)}`;
}

/** Called after the same-day alert email covered `alertIds` (critical / high, new). */
export async function enqueueAlertDeliveries(
  db: PrismaClient,
  orgId: string,
  alertIds: readonly string[],
  now: Date = new Date()
): Promise<number> {
  if (alertIds.length === 0) return 0;
  const targets = await enabledTargets(db, orgId, "alert");
  if (targets.length === 0) return 0;
  const scoped = withOrg(db, orgId);
  const streamIds = [...new Set(targets.flatMap((t) => (t.streamId ? [t.streamId] : [])))];
  const alertRepos = await scoped.alert.findMany({
    where: { id: { in: [...alertIds] } },
    select: { repoId: true },
  });
  const repoIds = new Set(alertRepos.map((a) => a.repoId));
  const covered = new Set(
    streamIds.length === 0
      ? []
      : (
          await scoped.streamRepo.findMany({
            where: { streamId: { in: streamIds }, repoId: { in: [...repoIds] } },
            select: { streamId: true },
          })
        ).map((r) => r.streamId)
  );
  const matching = targets.filter((t) => t.streamId === null || covered.has(t.streamId));
  const batchId = alertBatchId(alertIds);
  return enqueueFor(
    db,
    matching.map((t) => t.id),
    batchId,
    (targetId) => ({
      orgId,
      targetId,
      event: "alerts",
      batchId,
      alertIds: [...alertIds],
      occurredAt: now.toISOString(),
    })
  );
}

export interface DeliverDeps {
  post: PostFn;
}

async function eventFor(
  db: PrismaClient,
  payload: Payload,
  stream: { id: string; name: string } | null
): Promise<DeliveryEvent | null> {
  if (payload.event === "bulletin") return bulletinEvent(db, payload.orgId, payload.bulletinId);
  return alertEvent(db, payload.orgId, payload.alertIds, stream, new Date(payload.occurredAt));
}

/**
 * deliver-target. A target that is gone, turned off or no longer on the plan is skipped (and
 * kept). A failure is written to the target; a retryable one throws until the last attempt,
 * which records it and ends quietly: an owner's broken endpoint is not an operator alert.
 */
export async function runDeliverTarget(
  { db, log, jobId, payload: raw, attempt, maxAttempts }: JobContext,
  deps: DeliverDeps = { post: safePost }
): Promise<JobResult> {
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) {
    log.warn({ jobId }, "deliver-target: invalid payload, dropped");
    return { counts: { invalid: 1 } };
  }
  const payload = parsed.data;
  const target = await withOrg(db, payload.orgId).deliveryTarget.findFirst({
    where: { id: payload.targetId },
    select: {
      kind: true,
      url: true,
      secret: true,
      enabled: true,
      stream: { select: { id: true, name: true } },
    },
  });
  if (!target || !target.enabled) return { counts: { skipped: 1 } };
  if (!targetsAllowed(await loadOrgLimits(db, payload.orgId))) {
    return { counts: { skippedPlan: 1 } };
  }
  const event = await eventFor(db, payload, target.stream);
  if (!event) return { counts: { empty: 1 } };

  const result = await sendToTarget(target, event, jobId, deps.post);
  await recordDeliveryResult(db, payload.orgId, payload.targetId, result);
  const where = { orgId: payload.orgId, targetId: payload.targetId, kind: target.kind };
  if (result.ok) {
    log.info({ ...where, status: result.status }, "deliver-target: delivered");
    return { counts: { delivered: 1 } };
  }
  const last = (attempt ?? 1) >= (maxAttempts ?? 1);
  if (result.retry && !last) throw new Error(`deliver-target: ${result.error}`);
  log.warn({ ...where, error: result.error }, "deliver-target: failed for good");
  return { counts: { failed: 1 } };
}

export function deliverTarget(ctx: JobContext): Promise<JobResult> {
  return runDeliverTarget(ctx);
}

export function logEnqueueError(log: Logger, err: unknown, where: Record<string, unknown>): void {
  log.error({ err, ...where }, "deliver-target: could not enqueue");
}

/** "Send test": an owner posts the sample message now; the result is written to the target. */
export async function sendTestDelivery(
  db: PrismaClient,
  args: { orgId: string; userId: string; id: string },
  post: PostFn = safePost
): Promise<SendResult> {
  const scoped = withOrg(db, args.orgId);
  const member = await scoped.orgMember.findFirst({
    where: { userId: args.userId },
    select: { role: true },
  });
  if (member?.role !== "owner") throw new DeliveryTargetError("Only an owner can send a test.");
  const limits = await loadOrgLimits(db, args.orgId);
  if (!targetsAllowed(limits)) throw new DeliveryTargetError(notOnPlanMessage(limits));
  const target = await scoped.deliveryTarget.findFirst({
    where: { id: args.id },
    select: { kind: true, url: true, secret: true, stream: { select: { id: true, name: true } } },
  });
  if (!target) throw new DeliveryTargetError("That integration does not exist any more.");
  const event = testEvent({
    org: await orgRef(db, args.orgId),
    stream: target.stream,
    baseUrl: baseUrl(),
    now: new Date(),
  });
  const result = await sendToTarget(target, event, `test-${randomUUID()}`, post);
  await recordDeliveryResult(db, args.orgId, args.id, result);
  return result;
}
