import "server-only";

import {
  EventName,
  NodeRuntime,
  Webhooks,
  type EventEntity,
  type TransactionNotification,
} from "@paddle/paddle-node-sdk";

import type { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";

import type { PaddleEnv } from "./catalog";
import { signedOrgId } from "./org-link";
import { snapshotOf } from "./state";
import {
  applySubscription,
  lockOrgBilling,
  queueNotices,
  resolveSubscriptionOrg,
  type BillingTx,
} from "./sync";

// POST /api/billing/paddle (docs/BILLING.md): the route verifies the signature, then hands the
// event here. Every event is stored once in BillingEvent (its Paddle id is the key) and
// processed once: a retry of a processed event is a no-op, a failed one is processed again.

export const MAX_WEBHOOK_BYTES = 5 * 1024 * 1024;

const SUBSCRIPTION_EVENTS: ReadonlySet<string> = new Set([
  EventName.SubscriptionCreated,
  EventName.SubscriptionUpdated,
  EventName.SubscriptionActivated,
  EventName.SubscriptionCanceled,
  EventName.SubscriptionPastDue,
  EventName.SubscriptionPaused,
  EventName.SubscriptionResumed,
  EventName.SubscriptionTrialing,
]);

/** Recorded for debugging; the state they describe arrives with subscription events. */
const RECORDED_EVENTS: ReadonlySet<string> = new Set([
  EventName.TransactionPaymentFailed,
  EventName.CustomerUpdated,
]);

/** The verified event, or null for a bad signature, a stale timestamp or a malformed body. */
export async function verifyPaddleEvent(
  rawBody: string,
  secret: string,
  signature: string
): Promise<EventEntity | null> {
  NodeRuntime.initialize();
  try {
    return await new Webhooks().unmarshal(rawBody, secret, signature);
  } catch {
    return null;
  }
}

/** Locks the event row; true when this transaction should process it. */
async function claim(tx: Pick<BillingTx, "$queryRaw">, eventId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ processedAt: Date | null }[]>`
    SELECT "processedAt" FROM billing_event WHERE id = ${eventId} FOR UPDATE`;
  return rows.length === 1 && rows[0].processedAt === null;
}

async function markProcessed(tx: Pick<BillingTx, "$executeRaw">, eventId: string): Promise<void> {
  await tx.$executeRaw`UPDATE billing_event SET "processedAt" = now() AT TIME ZONE 'UTC', error = NULL WHERE id = ${eventId}`;
}

export interface HandleOptions {
  env: PaddleEnv;
  /** BETTER_AUTH_SECRET: verifies the signed org id in custom_data. */
  authSecret: string;
  now?: Date;
}

/**
 * Stores and processes one verified event. Returns a short result for the log; throws on a
 * processing error (stored on the BillingEvent) so the route answers non-2xx and Paddle retries.
 */
export async function handlePaddleEvent(
  db: PrismaClient,
  event: EventEntity,
  payload: unknown,
  options: HandleOptions
): Promise<string> {
  const occurredAt = new Date(event.occurredAt);
  await db.billingEvent.createMany({
    data: [
      {
        id: event.eventId,
        type: event.eventType,
        occurredAt,
        payload: payload as object,
      },
    ],
    skipDuplicates: true,
  });
  const stored = await db.billingEvent.findUnique({
    where: { id: event.eventId },
    select: { processedAt: true },
  });
  if (stored?.processedAt) return "duplicate";
  try {
    return await processEvent(db, event, occurredAt, options);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.billingEvent.update({
      where: { id: event.eventId },
      data: { error: message.slice(0, 2000) },
    });
    throw err;
  }
}

async function processEvent(
  db: PrismaClient,
  event: EventEntity,
  occurredAt: Date,
  options: HandleOptions
): Promise<string> {
  const now = options.now ?? new Date();
  if (SUBSCRIPTION_EVENTS.has(event.eventType)) {
    const data = event.data as Parameters<typeof snapshotOf>[0];
    const snap = snapshotOf(data, options.env);
    const orgId = await resolveSubscriptionOrg(db, snap, options.authSecret);
    return withOrg(db, orgId).$transaction(async (tx) => {
      if (!(await claim(tx, event.eventId))) return "duplicate";
      const result = await applySubscription(tx, orgId, snap, occurredAt, now);
      await queueNotices(tx, orgId, event.eventId, result.notices);
      await markProcessed(tx, event.eventId);
      return `${result.outcome}${result.notices.length ? ` (${result.notices.map((n) => n.kind).join(", ")})` : ""}`;
    });
  }
  if (event.eventType === EventName.TransactionCompleted) {
    return linkCustomer(db, event.eventId, event.data as TransactionNotification, options);
  }
  return db.$transaction(async (tx) => {
    if (!(await claim(tx, event.eventId))) return "duplicate";
    await markProcessed(tx, event.eventId);
    return RECORDED_EVENTS.has(event.eventType) ? "recorded" : "ignored";
  });
}

/**
 * A completed checkout names its org (signed custom data) and Paddle customer before the
 * subscription events may arrive: link the customer when the org has none yet.
 */
async function linkCustomer(
  db: PrismaClient,
  eventId: string,
  txn: TransactionNotification,
  options: HandleOptions
): Promise<string> {
  const orgId = signedOrgId(options.authSecret, txn.customData);
  const org = orgId
    ? await db.org.findUnique({ where: { id: orgId }, select: { id: true } })
    : null;
  if (!org || !txn.customerId) {
    return db.$transaction(async (tx) => {
      if (!(await claim(tx, eventId))) return "duplicate";
      await markProcessed(tx, eventId);
      return "recorded";
    });
  }
  const customerId = txn.customerId;
  return withOrg(db, org.id).$transaction(async (tx) => {
    if (!(await claim(tx, eventId))) return "duplicate";
    await lockOrgBilling(tx, org.id);
    const linked = await tx.org.updateMany({
      where: { id: org.id, paddleCustomerId: null },
      data: { paddleCustomerId: customerId },
    });
    await markProcessed(tx, eventId);
    return linked.count ? "customer linked" : "recorded";
  });
}
