import "server-only";

import { ApiError } from "@paddle/paddle-node-sdk";

import type { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { log } from "@/lib/log";
import { memberRole } from "@/lib/members";

import type { BillingApi, BillingTransaction } from "./api";
import { getBillingApi } from "./api";
import { priceFor, type PaddleEnv } from "./catalog";
import {
  isLive,
  prorationMode,
  snapshotOf,
  stateTime,
  type PaddleSubscriptionLike,
  type PlanTerms,
} from "./state";
import { applySubscription, queueNotices } from "./sync";

// Plan management behind Settings -> Billing (Server Actions in src/app/settings/billing).
// Every function re-reads the actor's role from the database, and acts only on the org's own
// subscription, found through withOrg: no subscription or customer id ever comes from the
// browser. A transaction id (invoice download) is checked against the org's subscriptions.

export const NOT_OWNER = "Only an owner can manage billing.";
const NO_SUBSCRIPTION = "This organisation has no active subscription.";
const NOT_CONFIGURED = "Billing is not configured on this instance.";
export const HISTORY_LIMIT = 12;

export type ManageResult<T extends object = object> =
  ({ ok: true } & T) | { ok: false; message: string };

export interface Actor {
  orgId: string;
  userId: string;
  email: string;
}

export interface PlanChangePreview {
  from: PlanTerms;
  to: PlanTerms;
  /** "now": the prorated difference is charged today; "next-bill": settled on the next bill. */
  billing: "now" | "next-bill";
  dueNow: string | null;
  recurring: string | null;
  nextBilledAt: string | null;
}

/** The subscription the billing page manages: the newest live one. */
export async function liveSubscription(db: PrismaClient, orgId: string) {
  const rows = await withOrg(db, orgId).subscription.findMany({ orderBy: { stateAt: "desc" } });
  return rows.find((r) => isLive(r.status)) ?? null;
}

type Live = NonNullable<Awaited<ReturnType<typeof liveSubscription>>>;

async function ownersSubscription(
  db: PrismaClient,
  actor: Actor
): Promise<{ ok: true; sub: Live } | { ok: false; message: string }> {
  if ((await memberRole(db, actor.orgId, actor.userId)) !== "owner") {
    return { ok: false, message: NOT_OWNER };
  }
  const sub = await liveSubscription(db, actor.orgId);
  return sub ? { ok: true, sub } : { ok: false, message: NO_SUBSCRIPTION };
}

function paddleMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.detail) return `Paddle: ${err.detail}`;
  return fallback;
}

/** Mirrors the state Paddle returned from a write right away; the webhook confirms it later. */
async function mirror(
  db: PrismaClient,
  orgId: string,
  env: PaddleEnv,
  remote: PaddleSubscriptionLike | null
): Promise<void> {
  if (!remote) return;
  const readAt = new Date();
  const snap = snapshotOf(remote, env);
  await withOrg(db, orgId).$transaction(async (tx) => {
    const result = await applySubscription(tx, orgId, snap, stateTime(snap, readAt), readAt);
    await queueNotices(
      tx,
      orgId,
      `action:${snap.paddleSubscriptionId}:${readAt.toISOString()}`,
      result.notices
    );
  });
}

function target(env: PaddleEnv, sub: Live, to: PlanTerms) {
  const price = priceFor(env, to.plan, to.interval);
  if (!price) return { ok: false as const, message: NOT_CONFIGURED };
  if (price.priceId === sub.paddlePriceId) {
    return { ok: false as const, message: "That is the current plan." };
  }
  const from: PlanTerms = {
    plan: sub.plan === "team" ? "team" : "pro",
    interval: sub.interval === "year" ? "year" : "month",
  };
  return { ok: true as const, priceId: price.priceId, from, mode: prorationMode(from, to) };
}

export async function previewPlanChange(
  db: PrismaClient,
  api: BillingApi,
  env: PaddleEnv,
  actor: Actor,
  to: PlanTerms
): Promise<ManageResult<{ preview: PlanChangePreview }>> {
  const owned = await ownersSubscription(db, actor);
  if (!owned.ok) return owned;
  const t = target(env, owned.sub, to);
  if (!t.ok) return t;
  try {
    const p = await api.previewPriceChange(owned.sub.paddleSubscriptionId, t.priceId, t.mode);
    return {
      ok: true,
      preview: {
        from: t.from,
        to,
        billing: t.mode === "prorated_immediately" ? "now" : "next-bill",
        dueNow: p.dueNow,
        recurring: p.recurring,
        nextBilledAt: p.nextBilledAt?.toISOString() ?? null,
      },
    };
  } catch (err) {
    log.warn({ err, orgId: actor.orgId }, "billing: preview failed");
    return {
      ok: false,
      message: paddleMessage(err, "Paddle could not preview this change. Try again."),
    };
  }
}

export async function changePlan(
  db: PrismaClient,
  api: BillingApi,
  env: PaddleEnv,
  actor: Actor,
  to: PlanTerms
): Promise<ManageResult> {
  const owned = await ownersSubscription(db, actor);
  if (!owned.ok) return owned;
  const t = target(env, owned.sub, to);
  if (!t.ok) return t;
  try {
    const remote = await api.changePrice(owned.sub.paddleSubscriptionId, t.priceId, t.mode);
    await mirror(db, actor.orgId, env, remote);
    log.info({ orgId: actor.orgId, userId: actor.userId, to }, "billing: plan changed");
    return { ok: true };
  } catch (err) {
    log.warn({ err, orgId: actor.orgId }, "billing: plan change failed");
    return {
      ok: false,
      message: paddleMessage(err, "Paddle did not accept the change; your plan stays as it was."),
    };
  }
}

export async function cancelSubscription(
  db: PrismaClient,
  api: BillingApi,
  env: PaddleEnv,
  actor: Actor
): Promise<ManageResult> {
  const owned = await ownersSubscription(db, actor);
  if (!owned.ok) return owned;
  try {
    await mirror(db, actor.orgId, env, await api.cancelAtPeriodEnd(owned.sub.paddleSubscriptionId));
    log.info({ orgId: actor.orgId, userId: actor.userId }, "billing: cancel scheduled");
    return { ok: true };
  } catch (err) {
    log.warn({ err, orgId: actor.orgId }, "billing: cancel failed");
    return {
      ok: false,
      message: paddleMessage(err, "Paddle did not accept the cancellation. Try again."),
    };
  }
}

export async function resumeSubscription(
  db: PrismaClient,
  api: BillingApi,
  env: PaddleEnv,
  actor: Actor
): Promise<ManageResult> {
  const owned = await ownersSubscription(db, actor);
  if (!owned.ok) return owned;
  try {
    await mirror(
      db,
      actor.orgId,
      env,
      await api.removeScheduledChange(owned.sub.paddleSubscriptionId)
    );
    log.info({ orgId: actor.orgId, userId: actor.userId }, "billing: cancel removed");
    return { ok: true };
  } catch (err) {
    log.warn({ err, orgId: actor.orgId }, "billing: resume failed");
    return {
      ok: false,
      message: paddleMessage(err, "Paddle did not resume the subscription. Try again."),
    };
  }
}

/**
 * A portal session for the org's Paddle customer, only for the person who pays: a Paddle
 * customer is one email and may pay for other orgs too, whose invoices and cards a co-owner of
 * this org must not see.
 */
export async function portalUrl(
  db: PrismaClient,
  api: BillingApi,
  actor: Actor
): Promise<ManageResult<{ url: string }>> {
  if ((await memberRole(db, actor.orgId, actor.userId)) !== "owner") {
    return { ok: false, message: NOT_OWNER };
  }
  const subs = await withOrg(db, actor.orgId).subscription.findMany({
    orderBy: { stateAt: "desc" },
    select: { paddleSubscriptionId: true, paddleCustomerId: true, status: true },
  });
  const current = subs.find((s) => isLive(s.status)) ?? subs[0];
  if (!current)
    return { ok: false, message: "There is nothing to manage yet: choose a plan first." };
  try {
    const payer = await api.customerEmail(current.paddleCustomerId);
    if (payer && payer.toLowerCase() !== actor.email.toLowerCase()) {
      return {
        ok: false,
        message: `Payment details belong to ${payer}, who pays for this plan. Ask them to open this page and use Manage payment method.`,
      };
    }
    const ids = subs
      .filter((s) => s.paddleCustomerId === current.paddleCustomerId)
      .map((s) => s.paddleSubscriptionId);
    return { ok: true, url: await api.portalUrl(current.paddleCustomerId, ids) };
  } catch (err) {
    log.warn({ err, orgId: actor.orgId }, "billing: portal session failed");
    return {
      ok: false,
      message: paddleMessage(err, "Paddle could not open the portal. Try again."),
    };
  }
}

/** The org's subscriptions grouped by Paddle customer, for history and invoice checks. */
async function orgSubscriptions(db: PrismaClient, orgId: string) {
  return withOrg(db, orgId).subscription.findMany({
    orderBy: { stateAt: "desc" },
    select: { paddleSubscriptionId: true, paddleCustomerId: true },
  });
}

/** The last transactions of the org's own subscriptions (never other orgs of the same payer). */
export async function billingHistory(
  db: PrismaClient,
  api: BillingApi,
  orgId: string
): Promise<BillingTransaction[]> {
  const subs = await orgSubscriptions(db, orgId);
  const byCustomer = new Map<string, string[]>();
  for (const s of subs) {
    byCustomer.set(s.paddleCustomerId, [
      ...(byCustomer.get(s.paddleCustomerId) ?? []),
      s.paddleSubscriptionId,
    ]);
  }
  const lists = await Promise.all(
    [...byCustomer].map(([customer, ids]) => api.listTransactions(customer, ids, HISTORY_LIMIT))
  );
  return lists
    .flat()
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, HISTORY_LIMIT);
}

export async function invoiceUrl(
  db: PrismaClient,
  api: BillingApi,
  actor: Actor,
  transactionId: string
): Promise<ManageResult<{ url: string }>> {
  if ((await memberRole(db, actor.orgId, actor.userId)) !== "owner") {
    return { ok: false, message: NOT_OWNER };
  }
  try {
    const owner = await api.transactionOwner(transactionId);
    const subs = await orgSubscriptions(db, actor.orgId);
    const own = subs.some(
      (s) =>
        s.paddleSubscriptionId === owner.subscriptionId && s.paddleCustomerId === owner.customerId
    );
    if (!own) return { ok: false, message: "That invoice does not belong to this organisation." };
    return { ok: true, url: await api.invoiceUrl(transactionId) };
  } catch (err) {
    log.warn({ err, orgId: actor.orgId }, "billing: invoice failed");
    return { ok: false, message: paddleMessage(err, "Paddle could not find that invoice.") };
  }
}

/**
 * Before an org is deleted: every subscription that is not canceled (paused ones too, which can
 * resume on their own) is canceled at once, so nobody is billed
 * for an org that no longer exists. Returns a refusal message when that is not possible.
 */
export async function endSubscriptions(db: PrismaClient, orgId: string): Promise<string | null> {
  const live = await withOrg(db, orgId).subscription.findMany({
    where: { status: { not: "canceled" } },
    select: { paddleSubscriptionId: true },
  });
  if (live.length === 0) return null;
  const api = getBillingApi();
  if (!api) {
    return "This organisation has a paid subscription and billing is not configured here to cancel it. Cancel it first, then delete the organisation.";
  }
  try {
    for (const s of live) await api.cancelNow(s.paddleSubscriptionId);
    return null;
  } catch (err) {
    log.error({ err, orgId }, "billing: cancel before delete failed");
    return "Paddle did not cancel the subscription, so the organisation was not deleted. Try again, or cancel it under Billing first.";
  }
}
