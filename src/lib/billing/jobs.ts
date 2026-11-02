import "server-only";

import { z } from "zod";

import { withOrg } from "@/lib/db/with-org";
import { renderBillingEmail, type BillingEmail } from "@/lib/email/billing-email";
import { sendMail } from "@/lib/email/mailer";
import { getEnv, isCloud } from "@/lib/env";
import { PLAN_IDS } from "@/lib/plans";
import type { JobContext, JobResult } from "@/worker/types";

import { getBillingApi } from "./api";
import { graceEndsAt, snapshotOf, stateTime } from "./state";
import { applyOrgPlan, applySubscription, lockOrgBilling, queueNotices } from "./sync";

const DAY_MS = 86_400_000;
/** billing-check reads a subscription from Paddle when its newest state is older than this. */
export const RECONCILE_AFTER_MS = DAY_MS;
/** Processed BillingEvent rows are kept this long for debugging. */
export const EVENT_RETENTION_MS = 180 * DAY_MS;

const plan = z.enum(PLAN_IDS);
const noticeSchema = z.object({ orgId: z.string().min(1), userId: z.string().min(1) }).and(
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("plan-changed"), from: plan, to: plan }),
    z.object({ kind: z.literal("payment-failed"), plan }),
    z.object({ kind: z.literal("canceled"), plan, endsAt: z.string() }),
    z.object({
      kind: z.literal("llm-budget"),
      threshold: z.union([z.literal(80), z.literal(100)]),
      spentUsd: z.number(),
      budgetUsd: z.number(),
    }),
  ])
);

/**
 * billing-notify: one billing email to one owner of the org (queueNotices makes one job per
 * owner in the transaction that made the change). A failed send throws, so the runner retries
 * this owner's email only; an owner who left or lost the role since is skipped.
 */
export async function billingNotify(ctx: JobContext): Promise<JobResult> {
  const notice = noticeSchema.parse(ctx.payload);
  const scoped = withOrg(ctx.db, notice.orgId);
  const [org, owner] = await Promise.all([
    ctx.db.org.findUnique({ where: { id: notice.orgId }, select: { name: true } }),
    scoped.orgMember.findFirst({
      where: { userId: notice.userId, role: "owner" },
      select: { user: { select: { email: true } } },
    }),
  ]);
  if (!org || !owner) return { counts: { skipped: 1 } };
  let email: BillingEmail;
  if (notice.kind === "payment-failed") {
    const sub = await scoped.subscription.findFirst({
      where: { status: "past_due" },
      orderBy: { pastDueSince: "desc" },
      select: { pastDueSince: true },
    });
    email = {
      kind: "payment-failed",
      plan: notice.plan,
      graceEndsAt: sub ? graceEndsAt(sub) : null,
    };
  } else if (notice.kind === "llm-budget") {
    email = notice;
  } else if (notice.kind === "canceled") {
    email = { kind: "canceled", plan: notice.plan, endsAt: new Date(notice.endsAt) };
  } else {
    email = { kind: "plan-changed", from: notice.from, to: notice.to };
  }
  const rendered = renderBillingEmail(email, {
    orgName: org.name,
    instanceUrl: getEnv().BETTER_AUTH_URL,
  });
  await ctx.heartbeat();
  const result = await sendMail({ to: owner.user.email, ...rendered });
  if (result.status === "failed") throw new Error(`billing-notify: send failed: ${result.error}`);
  return { counts: { [result.status]: 1 } };
}

/**
 * billing-check (daily): reads from Paddle every subscription that is not canceled and whose
 * newest state is older than a day; an answer newer than the stored state (a missed webhook) is
 * applied, then re-derives each org's plan, which ends the past_due grace
 * and a canceled plan's paid period. Prunes old processed events.
 */
export async function billingCheck(ctx: JobContext): Promise<JobResult> {
  const { db, log } = ctx;
  if (!isCloud()) return { counts: { skipped: 1 } };
  const env = getEnv();
  const api = env.BRIFF_PADDLE_FAKE ? null : getBillingApi();
  const now = new Date();
  const counts = { orgs: 0, reconciled: 0, failed: 0, planChanges: 0, pruned: 0 };
  // The one cross-org read of Subscription: which orgs have one (ids only).
  const orgIds = (
    await db.subscription.findMany({ distinct: ["orgId"], select: { orgId: true } })
  ).map((r) => r.orgId);
  for (const orgId of orgIds) {
    await ctx.heartbeat();
    counts.orgs++;
    const scoped = withOrg(db, orgId);
    if (api) {
      const stale = await scoped.subscription.findMany({
        where: {
          stateAt: { lt: new Date(now.getTime() - RECONCILE_AFTER_MS) },
          status: { not: "canceled" },
        },
        select: { paddleSubscriptionId: true },
      });
      for (const { paddleSubscriptionId } of stale) {
        await ctx.heartbeat();
        try {
          const readAt = new Date();
          const snap = snapshotOf(await api.getSubscription(paddleSubscriptionId), env.PADDLE_ENV);
          await scoped.$transaction(async (tx) => {
            const result = await applySubscription(tx, orgId, snap, stateTime(snap, readAt), now);
            await queueNotices(
              tx,
              orgId,
              `check:${paddleSubscriptionId}:${readAt.toISOString()}`,
              result.notices
            );
          });
          counts.reconciled++;
        } catch (err) {
          counts.failed++;
          log.error({ err, orgId, paddleSubscriptionId }, "billing-check: reconcile failed");
        }
      }
    }
    const change = await scoped.$transaction(async (tx) => {
      await lockOrgBilling(tx, orgId);
      const result = await applyOrgPlan(tx, orgId, now);
      if (result) {
        await queueNotices(tx, orgId, `check:${orgId}:${now.toISOString()}`, [
          { kind: "plan-changed", ...result },
        ]);
      }
      return result;
    });
    if (change) counts.planChanges++;
  }
  counts.pruned = (
    await db.billingEvent.deleteMany({
      where: { processedAt: { lt: new Date(now.getTime() - EVENT_RETENTION_MS) } },
    })
  ).count;
  return { counts };
}
