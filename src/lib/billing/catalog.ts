// Paddle price ids per environment: the one place they are written (docs/BILLING.md, "Live
// prices"). Pure, so the billing page, the webhook and the tests share it. Every price also
// carries `custom_data.plan` and `custom_data.interval` in Paddle; the webhook reads those first
// and falls back to this table.

import { PLAN_IDS, PLANS, type PlanId } from "@/lib/plans";

export const PADDLE_ENVS = ["sandbox", "live"] as const;
export type PaddleEnv = (typeof PADDLE_ENVS)[number];

export const PAID_PLAN_IDS = ["pro", "team"] as const;
export type PaidPlanId = (typeof PAID_PLAN_IDS)[number];

export const BILLING_INTERVALS = ["month", "year"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export interface CatalogPrice {
  priceId: string;
  plan: PaidPlanId;
  interval: BillingInterval;
}

export const PADDLE_CATALOG: Readonly<Record<PaddleEnv, readonly CatalogPrice[]>> = {
  sandbox: [
    { priceId: "pri_01m6f8cst11wvmmvpcw6k6q9xa", plan: "pro", interval: "month" },
    { priceId: "pri_01m6f8csyaetjaydk2fxa3m9wf", plan: "pro", interval: "year" },
    { priceId: "pri_01m6f8ct27w63hejyzxa69cdg9", plan: "team", interval: "month" },
    { priceId: "pri_01m6f8ct6a0dme5cygpx6yrajv", plan: "team", interval: "year" },
  ],
  // Filled in when the live catalog exists; until then live checkout reports "not configured".
  live: [],
};

export function isPaidPlanId(value: unknown): value is PaidPlanId {
  return typeof value === "string" && (PAID_PLAN_IDS as readonly string[]).includes(value);
}

export function isBillingInterval(value: unknown): value is BillingInterval {
  return typeof value === "string" && (BILLING_INTERVALS as readonly string[]).includes(value);
}

export function priceFor(
  env: PaddleEnv,
  plan: PaidPlanId,
  interval: BillingInterval
): CatalogPrice | null {
  return PADDLE_CATALOG[env].find((p) => p.plan === plan && p.interval === interval) ?? null;
}

export function catalogPrice(env: PaddleEnv, priceId: string): CatalogPrice | null {
  return PADDLE_CATALOG[env].find((p) => p.priceId === priceId) ?? null;
}

/** Every paid plan has both intervals in this environment. */
export function catalogComplete(env: PaddleEnv): boolean {
  return PAID_PLAN_IDS.every((plan) =>
    BILLING_INTERVALS.every((interval) => priceFor(env, plan, interval) !== null)
  );
}

/** The list price in USD from PLANS (Paddle may localise what the buyer pays). */
export function listPriceUsd(plan: PaidPlanId, interval: BillingInterval): number {
  const p = PLANS[plan];
  return (interval === "month" ? p.monthlyUsd : p.yearlyUsd) ?? 0;
}

/** Plans in upgrade order; a higher rank is the bigger plan. */
export function planRank(plan: PlanId): number {
  return PLAN_IDS.indexOf(plan);
}
