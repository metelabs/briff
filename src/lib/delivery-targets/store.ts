import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { loadOrgLimits } from "@/lib/org-limits";
import { deliveryTargetDetail } from "@/lib/org-events";
import { PLANS, teamFeaturePlan, type OrgLimits } from "@/lib/plans";

import { checkTargetUrl, maskUrl, newWebhookSecret, type DeliveryTargetKind } from "./format";

// Delivery targets (Settings → Integrations). Owners manage them; every write re-reads the
// role and the plan inside the org's limits lock, so a check in the UI is never the only one.

export const TARGET_ERROR_MAX = 500;

export class DeliveryTargetError extends Error {}

export function targetsAllowed(limits: Pick<OrgLimits, "deliveryTargets">): boolean {
  return limits.deliveryTargets !== 0;
}

export function notOnPlanMessage(limits: Pick<OrgLimits, "plan">): string {
  return `Slack and webhook delivery is included in ${teamFeaturePlan().name}; this organisation is on ${PLANS[limits.plan].name}. See Settings → Billing.`;
}

export interface DeliveryTargetRow {
  id: string;
  kind: DeliveryTargetKind;
  /** Host and last 4 characters only. */
  urlLabel: string;
  streamId: string | null;
  streamName: string | null;
  bulletin: boolean;
  alert: boolean;
  enabled: boolean;
  signed: boolean;
  lastDeliveredAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  createdAt: Date;
}

export async function listDeliveryTargets(
  db: PrismaClient,
  orgId: string
): Promise<DeliveryTargetRow[]> {
  const rows = await withOrg(db, orgId).deliveryTarget.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      kind: true,
      url: true,
      streamId: true,
      stream: { select: { name: true } },
      bulletin: true,
      alert: true,
      enabled: true,
      secret: true,
      lastDeliveredAt: true,
      lastError: true,
      lastErrorAt: true,
      createdAt: true,
    },
  });
  return rows.map(({ url, stream, secret, ...r }) => ({
    ...r,
    urlLabel: maskUrl(url),
    streamName: stream?.name ?? null,
    signed: secret !== null,
  }));
}

type Tx = Parameters<Parameters<ReturnType<typeof withOrg>["$transaction"]>[0]>[0];

/** The org's limits lock (same key as streams), the caller's role and the limits under it. */
async function lockedOwner(tx: Tx, orgId: string, userId: string): Promise<OrgLimits> {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(68422::int, hashtext(${orgId}))`;
  const member = await tx.orgMember.findFirst({ where: { userId }, select: { role: true } });
  if (member?.role !== "owner") {
    throw new DeliveryTargetError("Only an owner can change integrations.");
  }
  return loadOrgLimits(tx, orgId);
}

export interface NewDeliveryTarget {
  orgId: string;
  userId: string;
  kind: DeliveryTargetKind;
  url: string;
  streamId: string | null;
  bulletin: boolean;
  alert: boolean;
}

export async function createDeliveryTarget(
  db: PrismaClient,
  input: NewDeliveryTarget
): Promise<{ id: string; secret: string | null; urlLabel: string }> {
  const checked = checkTargetUrl(input.kind, input.url);
  if (!checked.ok) throw new DeliveryTargetError(checked.message);
  if (!input.bulletin && !input.alert) {
    throw new DeliveryTargetError("Pick at least one: bulletins or security alerts.");
  }
  const { orgId } = input;
  return withOrg(db, orgId).$transaction(async (tx) => {
    const limits = await lockedOwner(tx, orgId, input.userId);
    if (!targetsAllowed(limits)) throw new DeliveryTargetError(notOnPlanMessage(limits));
    if (
      limits.deliveryTargets !== null &&
      (await tx.deliveryTarget.count()) >= limits.deliveryTargets
    ) {
      throw new DeliveryTargetError(
        `Integration limit reached (${limits.deliveryTargets} on the ${PLANS[limits.plan].name} plan).`
      );
    }
    if (input.streamId) {
      const stream = await tx.bulletinStream.findFirst({
        where: { id: input.streamId },
        select: { id: true },
      });
      if (!stream) throw new DeliveryTargetError("That stream does not exist any more.");
    }
    const secret = input.kind === "webhook" ? newWebhookSecret() : null;
    const created = await tx.deliveryTarget.create({
      data: {
        orgId,
        kind: input.kind,
        url: checked.url,
        secret,
        streamId: input.streamId,
        bulletin: input.bulletin,
        alert: input.alert,
        createdByUserId: input.userId,
      },
      select: { id: true },
    });
    const urlLabel = maskUrl(checked.url);
    await tx.orgEvent.create({
      data: {
        orgId,
        actorUserId: input.userId,
        type: "delivery_target_created",
        detail: deliveryTargetDetail(input.kind, urlLabel),
      },
    });
    return { id: created.id, secret, urlLabel };
  });
}

/** Turning a target on needs the plan; turning it off and deleting never do (downgrades). */
export async function setDeliveryTargetEnabled(
  db: PrismaClient,
  args: { orgId: string; userId: string; id: string; enabled: boolean }
): Promise<void> {
  const { orgId } = args;
  await withOrg(db, orgId).$transaction(async (tx) => {
    const limits = await lockedOwner(tx, orgId, args.userId);
    if (args.enabled && !targetsAllowed(limits)) {
      throw new DeliveryTargetError(notOnPlanMessage(limits));
    }
    const target = await tx.deliveryTarget.findFirst({
      where: { id: args.id },
      select: { kind: true, url: true, enabled: true },
    });
    if (!target) throw new DeliveryTargetError("That integration does not exist any more.");
    if (target.enabled === args.enabled) return;
    await tx.deliveryTarget.updateMany({ where: { id: args.id }, data: { enabled: args.enabled } });
    await tx.orgEvent.create({
      data: {
        orgId,
        actorUserId: args.userId,
        type: args.enabled ? "delivery_target_enabled" : "delivery_target_disabled",
        detail: deliveryTargetDetail(target.kind, maskUrl(target.url)),
      },
    });
  });
}

export async function deleteDeliveryTarget(
  db: PrismaClient,
  args: { orgId: string; userId: string; id: string }
): Promise<void> {
  const { orgId } = args;
  await withOrg(db, orgId).$transaction(async (tx) => {
    await lockedOwner(tx, orgId, args.userId);
    const target = await tx.deliveryTarget.findFirst({
      where: { id: args.id },
      select: { kind: true, url: true },
    });
    if (!target) return;
    await tx.deliveryTarget.deleteMany({ where: { id: args.id } });
    await tx.orgEvent.create({
      data: {
        orgId,
        actorUserId: args.userId,
        type: "delivery_target_deleted",
        detail: deliveryTargetDetail(target.kind, maskUrl(target.url)),
      },
    });
  });
}

/** After a send: success clears the error, a failure keeps the last success. */
export async function recordDeliveryResult(
  db: PrismaClient,
  orgId: string,
  targetId: string,
  result: { ok: true } | { ok: false; error: string },
  now: Date = new Date()
): Promise<void> {
  await withOrg(db, orgId).deliveryTarget.updateMany({
    where: { id: targetId },
    data: result.ok
      ? { lastDeliveredAt: now, lastError: null, lastErrorAt: null }
      : { lastError: result.error.slice(0, TARGET_ERROR_MAX), lastErrorAt: now },
  });
}
