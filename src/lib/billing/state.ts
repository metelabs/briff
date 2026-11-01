// Pure billing rules: a Paddle subscription (webhook notification or API entity) to the row we
// store, which plan that row entitles the org to, and when Paddle may change the org's plan.
// No database and no SDK calls, so every rule is unit-tested (state.test.ts).

import type {
  CustomData,
  Interval,
  ProrationBillingMode,
  ScheduledChangeAction,
  SubscriptionStatus,
} from "@paddle/paddle-node-sdk";

import type { PlanId } from "@/lib/plans";

import {
  catalogPrice,
  isBillingInterval,
  isPaidPlanId,
  planRank,
  type BillingInterval,
  type PaddleEnv,
  type PaidPlanId,
} from "./catalog";

/** Days a past_due subscription keeps its plan while Paddle retries the payment. */
export const PAST_DUE_GRACE_DAYS = 14;
const DAY_MS = 86_400_000;

export interface ScheduledChange {
  action: ScheduledChangeAction;
  effectiveAt: string;
  resumeAt: string | null;
}

/**
 * The fields read from the SDK's SubscriptionNotification (webhook) and Subscription (API),
 * which share these camelCase shapes.
 */
export interface PaddleSubscriptionLike {
  id: string;
  status: SubscriptionStatus;
  customerId: string;
  nextBilledAt: string | null;
  canceledAt: string | null;
  currentBillingPeriod: { endsAt: string } | null;
  billingCycle: { interval: Interval } | null;
  scheduledChange: ScheduledChange | null;
  items: { price: { id: string; customData: CustomData | null } | null }[];
  customData: CustomData | null;
}

export interface SubscriptionSnapshot {
  paddleSubscriptionId: string;
  paddleCustomerId: string;
  paddlePriceId: string;
  plan: PaidPlanId;
  interval: BillingInterval;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  nextBilledAt: Date | null;
  scheduledChange: ScheduledChange | null;
  canceledAt: Date | null;
  /** `custom_data` set at checkout: `{ orgId, orgSig }` (org-link.ts). */
  customData: CustomData | null;
}

/** An event or API answer that cannot be mapped to a plan or an org. */
export class BillingMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingMappingError";
  }
}

function date(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function priceTerms(
  env: PaddleEnv,
  price: { id: string; customData: CustomData | null },
  cycle: Interval | undefined
): { plan: PaidPlanId; interval: BillingInterval } | null {
  const data = price.customData ?? {};
  const listed = catalogPrice(env, price.id);
  const plan = isPaidPlanId(data.plan) ? data.plan : listed?.plan;
  const interval = isBillingInterval(data.interval)
    ? data.interval
    : isBillingInterval(cycle)
      ? cycle
      : listed?.interval;
  return plan && interval ? { plan, interval } : null;
}

/** Throws BillingMappingError when no item's price names a Briff plan. */
export function snapshotOf(sub: PaddleSubscriptionLike, env: PaddleEnv): SubscriptionSnapshot {
  for (const item of sub.items) {
    if (!item.price) continue;
    const terms = priceTerms(env, item.price, sub.billingCycle?.interval);
    if (!terms) continue;
    return {
      paddleSubscriptionId: sub.id,
      paddleCustomerId: sub.customerId,
      paddlePriceId: item.price.id,
      plan: terms.plan,
      interval: terms.interval,
      status: sub.status,
      currentPeriodEnd: date(sub.currentBillingPeriod?.endsAt),
      nextBilledAt: date(sub.nextBilledAt),
      scheduledChange: sub.scheduledChange
        ? {
            action: sub.scheduledChange.action,
            effectiveAt: sub.scheduledChange.effectiveAt,
            resumeAt: sub.scheduledChange.resumeAt ?? null,
          }
        : null,
      canceledAt: date(sub.canceledAt),
      customData: sub.customData,
    };
  }
  throw new BillingMappingError(
    `subscription ${sub.id}: no item has a Briff price (custom_data.plan or a catalog id)`
  );
}

/** A stored state at `stateAt` is newer than an event that occurred at `occurredAt`. */
export function isStale(stateAt: Date | null, occurredAt: Date): boolean {
  return stateAt !== null && stateAt.getTime() > occurredAt.getTime();
}

/** past_due starts the grace clock once and keeps its start until the status changes. */
export function pastDueSince(
  status: SubscriptionStatus,
  previous: { status: string; pastDueSince: Date | null } | null,
  at: Date
): Date | null {
  if (status !== "past_due") return null;
  return previous?.status === "past_due" && previous.pastDueSince ? previous.pastDueSince : at;
}

export interface EntitlementRow {
  status: string;
  plan: PlanId;
  pastDueSince: Date | null;
  currentPeriodEnd: Date | null;
}

/** When a past_due row loses its plan. */
export function graceEndsAt(row: Pick<EntitlementRow, "pastDueSince">): Date | null {
  return row.pastDueSince
    ? new Date(row.pastDueSince.getTime() + PAST_DUE_GRACE_DAYS * DAY_MS)
    : null;
}

/**
 * The plan one subscription gives the org at `now`: active and trialing keep it; past_due keeps
 * it for the grace period; canceled keeps it only to the end of a period already paid for;
 * paused and anything unknown give nothing.
 */
export function entitledPlan(row: EntitlementRow, now: Date): PlanId {
  switch (row.status) {
    case "active":
    case "trialing":
      return row.plan;
    case "past_due": {
      const ends = graceEndsAt(row);
      return ends && now.getTime() < ends.getTime() ? row.plan : "free";
    }
    case "canceled":
      return row.currentPeriodEnd && now.getTime() < row.currentPeriodEnd.getTime()
        ? row.plan
        : "free";
    default:
      return "free";
  }
}

/** The biggest plan any of the org's subscriptions entitles it to; Free with none. */
export function targetPlan(rows: readonly EntitlementRow[], now: Date): PlanId {
  let best: PlanId = "free";
  for (const row of rows) {
    const plan = entitledPlan(row, now);
    if (planRank(plan) > planRank(best)) best = plan;
  }
  return best;
}

export type PlanSourceId = "default" | "admin" | "paddle";

export type PlanDecision =
  | { write: false; reason: "unchanged" | "unlimited" | "admin-plan" }
  | { write: true; plan: PlanId };

/**
 * Whether billing may set the org's plan to `target`. Unlimited is never touched, and a plan the
 * instance admin set is never lowered by billing (a bigger paid plan still applies and from then
 * on belongs to billing). The same plan is rewritten only to take it over from the admin, so a
 * later cancellation can lower it.
 */
export function planDecision(
  org: { plan: PlanId; planSource: PlanSourceId },
  target: PlanId
): PlanDecision {
  if (org.plan === "unlimited") return { write: false, reason: "unlimited" };
  if (target === org.plan) {
    return org.planSource !== "paddle" && target !== "free"
      ? { write: true, plan: target }
      : { write: false, reason: "unchanged" };
  }
  if (planRank(target) < planRank(org.plan) && org.planSource === "admin") {
    return { write: false, reason: "admin-plan" };
  }
  return { write: true, plan: target };
}

/** A subscription that still bills: the one the billing page manages. */
export function isLive(status: string): boolean {
  return status === "active" || status === "trialing" || status === "past_due";
}

export interface PlanTerms {
  plan: PaidPlanId;
  interval: BillingInterval;
}

/**
 * Upgrades (a bigger plan, or monthly to yearly on the same plan) are charged the prorated
 * difference now; downgrades and yearly to monthly settle on the next bill, so nothing is
 * refunded mid-period (subscription-update skill).
 */
export function prorationMode(from: PlanTerms, to: PlanTerms): ProrationBillingMode {
  const tier = planRank(to.plan) - planRank(from.plan);
  if (tier > 0) return "prorated_immediately";
  if (tier < 0) return "prorated_next_billing_period";
  return from.interval === "month" && to.interval === "year"
    ? "prorated_immediately"
    : "prorated_next_billing_period";
}

const ZERO_DECIMAL = new Set(["JPY", "KRW", "CLP"]);

/** Paddle amounts are strings in the lowest unit; JPY, KRW and CLP have none (billing-history skill). */
export function formatMoney(amount: string | null | undefined, currency: string): string {
  const value = Number.parseFloat(amount ?? "0");
  const units = ZERO_DECIMAL.has(currency) ? value : value / 100;
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    Number.isFinite(units) ? units : 0
  );
}
