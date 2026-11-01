import "server-only";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { OrgDb } from "@/lib/db/with-org";
import { planChangeDetail } from "@/lib/org-events";
import type { PlanId } from "@/lib/plans";

import { scheduledOf } from "./labels";
import { signedOrgId } from "./org-link";
import {
  BillingMappingError,
  isStale,
  pastDueSince,
  planDecision,
  targetPlan,
  type SubscriptionSnapshot,
} from "./state";

// The only code (with the admin's Edit limits action) that writes Org.plan: it mirrors a Paddle
// subscription into `Subscription` and derives the org's plan from all of its subscriptions.
// Callers hold one transaction from `withOrg(db, orgId).$transaction` (webhook, billing-check).

export type BillingTx = Pick<
  OrgDb,
  "subscription" | "org" | "orgEvent" | "orgMember" | "job" | "$queryRaw" | "$executeRaw"
>;

export type BillingNotice =
  | { kind: "plan-changed"; from: PlanId; to: PlanId }
  | { kind: "payment-failed"; plan: PlanId }
  | { kind: "canceled"; plan: PlanId; endsAt: string };

/** Serialises billing writes of one org (webhook deliveries, billing-check, admin). */
export async function lockOrgBilling(tx: Pick<OrgDb, "$queryRaw">, orgId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`billing-org:${orgId}`}))`;
}

/**
 * The org a Paddle subscription belongs to, before the org is known: the signed org id set at
 * checkout, else the org already holding the subscription, else the only org with its Paddle
 * customer. The one tenant read outside withOrg here (by Paddle's unique subscription id).
 */
export async function resolveSubscriptionOrg(
  db: PrismaClient,
  snap: Pick<SubscriptionSnapshot, "paddleSubscriptionId" | "paddleCustomerId" | "customData">,
  secret: string
): Promise<string> {
  const held = await db.subscription.findUnique({
    where: { paddleSubscriptionId: snap.paddleSubscriptionId },
    select: { orgId: true },
  });
  if (held) return held.orgId;
  const signed = signedOrgId(secret, snap.customData);
  if (signed && (await db.org.count({ where: { id: signed } })) === 1) return signed;
  const byCustomer = await db.org.findMany({
    where: { paddleCustomerId: snap.paddleCustomerId },
    select: { id: true },
    take: 2,
  });
  if (byCustomer.length === 1) return byCustomer[0].id;
  throw new BillingMappingError(
    byCustomer.length === 0
      ? `subscription ${snap.paddleSubscriptionId}: no org (no signed custom_data.orgId, unknown customer)`
      : `subscription ${snap.paddleSubscriptionId}: customer is linked to several orgs and custom_data has no signed org`
  );
}

/**
 * Sets the org's plan from its subscriptions (`targetPlan` + `planDecision`), recording the
 * change as an OrgEvent. Returns the change, or null when the plan stays.
 */
export async function applyOrgPlan(
  tx: BillingTx,
  orgId: string,
  now: Date
): Promise<{ from: PlanId; to: PlanId } | null> {
  const [org, rows] = await Promise.all([
    tx.org.findUniqueOrThrow({ where: { id: orgId }, select: { plan: true, planSource: true } }),
    tx.subscription.findMany({
      select: { status: true, plan: true, pastDueSince: true, currentPeriodEnd: true },
    }),
  ]);
  const decision = planDecision(org, targetPlan(rows, now));
  if (!decision.write) return null;
  const changed = decision.plan !== org.plan;
  await tx.org.update({
    where: { id: orgId },
    data: { plan: decision.plan, planSource: "paddle", ...(changed ? { planUpdatedAt: now } : {}) },
  });
  if (!changed) return null;
  await tx.orgEvent.create({
    data: {
      orgId,
      type: "plan_changed",
      actorUserId: null,
      detail: planChangeDetail("paddle", org.plan, decision.plan),
    },
  });
  return { from: org.plan, to: decision.plan };
}

export interface ApplyResult {
  outcome: "applied" | "stale";
  notices: BillingNotice[];
}

/**
 * Mirrors one subscription state that was true at `at` (an event's occurred_at, or the time
 * billing-check read the API), then re-derives the plan. An older state than the stored one is
 * ignored, so out-of-order deliveries converge on the newest.
 */
export async function applySubscription(
  tx: BillingTx,
  orgId: string,
  snap: SubscriptionSnapshot,
  at: Date,
  now: Date
): Promise<ApplyResult> {
  await lockOrgBilling(tx, orgId);
  const previous = await tx.subscription.findUnique({
    where: { paddleSubscriptionId: snap.paddleSubscriptionId },
    select: { status: true, pastDueSince: true, scheduledChange: true, stateAt: true },
  });
  if (previous && isStale(previous.stateAt, at)) return { outcome: "stale", notices: [] };

  const fields = {
    paddleCustomerId: snap.paddleCustomerId,
    paddlePriceId: snap.paddlePriceId,
    plan: snap.plan,
    interval: snap.interval,
    status: snap.status,
    currentPeriodEnd: snap.currentPeriodEnd,
    nextBilledAt: snap.nextBilledAt,
    scheduledChange: snap.scheduledChange ? { ...snap.scheduledChange } : Prisma.DbNull,
    canceledAt: snap.canceledAt,
    pastDueSince: pastDueSince(snap.status, previous, at),
    stateAt: at,
  };
  await tx.subscription.upsert({
    where: { paddleSubscriptionId: snap.paddleSubscriptionId },
    create: { orgId, paddleSubscriptionId: snap.paddleSubscriptionId, ...fields },
    update: fields,
  });
  await tx.org.update({ where: { id: orgId }, data: { paddleCustomerId: snap.paddleCustomerId } });

  const notices: BillingNotice[] = [];
  const change = await applyOrgPlan(tx, orgId, now);
  if (change) notices.push({ kind: "plan-changed", ...change });
  if (snap.status === "past_due" && previous?.status !== "past_due") {
    notices.push({ kind: "payment-failed", plan: snap.plan });
  }
  const wasCanceling = scheduledOf(previous?.scheduledChange)?.action === "cancel";
  if (snap.scheduledChange?.action === "cancel" && !wasCanceling && snap.status !== "canceled") {
    notices.push({ kind: "canceled", plan: snap.plan, endsAt: snap.scheduledChange.effectiveAt });
  }
  return { outcome: "applied", notices };
}

/**
 * Queues the owner emails in the same transaction: one job per (ref, kind, owner), so a retry
 * resends only the email that failed and never one that went out.
 */
export async function queueNotices(
  tx: BillingTx,
  orgId: string,
  ref: string,
  notices: readonly BillingNotice[]
): Promise<void> {
  if (notices.length === 0) return;
  const owners = await tx.orgMember.findMany({
    where: { role: "owner" },
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  });
  for (const notice of notices) {
    for (const { userId } of owners) {
      await tx.job.create({
        data: {
          type: "billing-notify",
          dedupeKey: `billing-notify:${ref}:${notice.kind}:${userId}`,
          payload: { orgId, userId, ...notice },
        },
      });
    }
  }
}
