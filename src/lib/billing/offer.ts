// What the billing page may offer an owner: a checkout (and for which plans), the change-plan
// panel of a live subscription, or the instance admin's notice. Pure; the page renders it and
// the checkout action enforces it (manage.ts `checkoutSession`).

import type { PlanId } from "@/lib/plans";

import { PAID_PLAN_IDS, type PaidPlanId } from "./catalog";
import type { PlanSourceId } from "./state";

export type BillingOffer =
  /** A live (or paused) subscription: change plan, cancel, resume. */
  | { kind: "subscribed" }
  /** Unlimited, or a paid plan the instance admin set: nothing to buy here. */
  | { kind: "admin" }
  | { kind: "checkout"; plans: PaidPlanId[] };

export const ADMIN_PLAN_NOTICE =
  "Your plan is set by the instance admin. Billing is managed outside Paddle; contact support to change it.";

export function billingOffer(org: {
  plan: PlanId;
  planSource: PlanSourceId;
  /** The org has a subscription that has not ended (`liveSubscription`). */
  subscribed: boolean;
}): BillingOffer {
  if (org.subscribed) return { kind: "subscribed" };
  if (org.plan === "unlimited") return { kind: "admin" };
  // An admin-set Free (overrides only) may still buy a plan, which then belongs to billing.
  if (org.planSource === "admin" && org.plan !== "free") return { kind: "admin" };
  // Never a checkout for the plan the org already has (a canceled plan still in its period).
  return { kind: "checkout", plans: PAID_PLAN_IDS.filter((p) => p !== org.plan) };
}

export function planSourceOf(value: string): PlanSourceId {
  return value === "admin" || value === "paddle" ? value : "default";
}
