// Monthly LLM budget per org (hosted service only): pure maths over the plan table and the
// month-to-date estimate from OrgUsage. Past the budget, the weekly synthesis runs in economy
// mode (triage model, shorter output, "Condensed edition"); nothing is skipped, and same-day
// security alerts never read the budget.

import { PLAN_ALLOWANCES, type PlanId } from "@/lib/plans";

export const BUDGET_THRESHOLDS = [80, 100] as const;
export type BudgetThreshold = (typeof BUDGET_THRESHOLDS)[number];

/** Output cap of a condensed synthesis (the normal one is 16000). */
export const ECONOMY_MAX_TOKENS = 8000;

/** The org's budget in USD, or null for none: self-hosted, Unlimited, or no plan budget. */
export function llmBudgetFor(
  org: { plan: PlanId; llmBudgetUsd: number | null },
  { cloud }: { cloud: boolean }
): number | null {
  if (!cloud) return null;
  // The admin's value replaces the plan's either way (raise a friend, cap an abuser).
  return org.llmBudgetUsd ?? PLAN_ALLOWANCES[org.plan].llmBudgetUsd;
}

/** Economy mode once the month-to-date estimate reaches the budget. */
export function overBudget(spentUsd: number, budgetUsd: number | null): boolean {
  return budgetUsd !== null && spentUsd >= budgetUsd;
}

/** The highest threshold the spend has reached (80 or 100), or 0. */
export function reachedThreshold(spentUsd: number, budgetUsd: number | null): 0 | BudgetThreshold {
  if (budgetUsd === null) return 0;
  // A zero budget is used up from the first cent.
  if (budgetUsd <= 0) return spentUsd > 0 ? 100 : 0;
  const pct = (spentUsd / budgetUsd) * 100;
  return pct >= 100 ? 100 : pct >= 80 ? 80 : 0;
}

/** Whole percent for display, capped at 999. */
export function budgetPercent(spentUsd: number, budgetUsd: number): number {
  if (budgetUsd <= 0) return spentUsd > 0 ? 100 : 0;
  return Math.min(999, Math.floor((spentUsd / budgetUsd) * 100));
}

/** First day of the UTC month. */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** First day of the previous UTC month. */
export function previousMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
}

/** UTC midnight of the day (OrgUsage.day). */
export function utcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** "2026-11" */
export function monthKey(now: Date): string {
  return now.toISOString().slice(0, 7);
}
