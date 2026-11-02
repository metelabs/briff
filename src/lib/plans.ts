// Plans and their limits: the one table the pricing page, Settings, Admin and every limit
// check read. Pure (no env, no database), so the public pricing page can import it; callers
// pass whether this instance is the hosted service (`isCloud()`, BRIFF_CLOUD).

import { plural } from "@/lib/format";

/** The values of the Prisma enum `OrgPlan`, in upgrade order. */
export const PLAN_IDS = ["free", "pro", "team", "unlimited"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface Plan {
  id: PlanId;
  name: string;
  /** USD; null for a plan that is not sold. */
  monthlyUsd: number | null;
  yearlyUsd: number | null;
  /** null = unlimited. */
  repos: number | null;
  streams: number | null;
  members: number | null;
  /** One sentence for the pricing card. */
  pitch: string;
  /** Slack and webhook delivery targets; null = unlimited, 0 = not on this plan. */
  deliveryTargets: number | null;
  auditExport: boolean;
  /** What the plan adds on top of INCLUDED_FEATURES, listed on its pricing card. */
  extras: readonly string[];
}

export const PLANS: Readonly<Record<PlanId, Plan>> = {
  free: {
    id: "free",
    name: "Free",
    monthlyUsd: 0,
    yearlyUsd: 0,
    repos: 10,
    streams: 2,
    members: 1,
    pitch: "For one developer and a handful of repos.",
    deliveryTargets: 0,
    auditExport: false,
    extras: [],
  },
  pro: {
    id: "pro",
    name: "Pro",
    monthlyUsd: 4,
    yearlyUsd: 40,
    repos: 50,
    streams: 10,
    members: 3,
    pitch: "For a freelancer or a small studio with many client repos.",
    deliveryTargets: 0,
    auditExport: false,
    extras: [],
  },
  team: {
    id: "team",
    name: "Team",
    monthlyUsd: 12,
    yearlyUsd: 120,
    repos: null,
    streams: null,
    members: 10,
    pitch: "For a team that ships every repo it has.",
    deliveryTargets: null,
    auditExport: true,
    extras: ["Slack and webhook delivery", "Audit log export", "Priority support (1 business day)"],
  },
  // The founder's own org and friends; set in Admin, never sold.
  unlimited: {
    id: "unlimited",
    name: "Unlimited",
    monthlyUsd: null,
    yearlyUsd: null,
    repos: null,
    streams: null,
    members: null,
    pitch: "",
    deliveryTargets: null,
    auditExport: true,
    extras: [],
  },
};

/** The plans on the pricing page, in order. */
export const PRICED_PLANS: readonly Plan[] = [PLANS.free, PLANS.pro, PLANS.team];

/** Included on every plan; the plans differ in their limits and Team's `extras`. */
export const INCLUDED_FEATURES: readonly string[] = [
  "Weekly bulletin per stream",
  "Same-day security alerts",
  "Re-check on demand",
  "Stack drift and end-of-life dates",
];

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);
}

export interface OrgLimits {
  /** The plan the limits come from; "unlimited" on a self-hosted instance. */
  plan: PlanId;
  /** null = unlimited. */
  repoLimit: number | null;
  streamLimit: number | null;
  memberLimit: number | null;
  /** Slack / webhook targets (src/lib/delivery-targets); 0 = not on the plan. */
  deliveryTargets: number | null;
  auditExport: boolean;
}

export interface OrgPlanRow {
  plan: PlanId;
  /** The instance admin's overrides; null = the plan's limit. */
  repoLimit: number | null;
  streamLimit: number | null;
}

/** An override raises a limit; it never lowers the plan's, and nothing beats unlimited. */
function withOverride(planLimit: number | null, override: number | null): number | null {
  if (planLimit === null) return null;
  return override === null ? planLimit : Math.max(planLimit, override);
}

/**
 * The limits an org works under. Self-hosted (`cloud` false) every org is unlimited whatever
 * its columns say; on the hosted service the plan's limits, raised by the admin's overrides.
 */
export function limitsFor(org: OrgPlanRow, { cloud }: { cloud: boolean }): OrgLimits {
  if (!cloud) {
    return {
      plan: "unlimited",
      repoLimit: null,
      streamLimit: null,
      memberLimit: null,
      deliveryTargets: null,
      auditExport: true,
    };
  }
  const plan = PLANS[org.plan];
  return {
    plan: plan.id,
    repoLimit: withOverride(plan.repos, org.repoLimit),
    streamLimit: withOverride(plan.streams, org.streamLimit),
    memberLimit: plan.members,
    deliveryTargets: plan.deliveryTargets,
    auditExport: plan.auditExport,
  };
}

/** The cheapest sold plan that has delivery targets and the audit export ("Included in Team"). */
export function teamFeaturePlan(): Plan {
  return PRICED_PLANS.find((p) => p.deliveryTargets !== 0 && p.auditExport) ?? PLANS.team;
}

/** False for null (unlimited). */
export function atLimit(used: number, limit: number | null): boolean {
  return limit !== null && used >= limit;
}

/** The next plan on the pricing page, or null when there is none to upgrade to. */
export function nextPlan(plan: PlanId): Plan | null {
  const i = PRICED_PLANS.findIndex((p) => p.id === plan);
  return i === -1 ? null : (PRICED_PLANS[i + 1] ?? null);
}

/** "$4", "$0". */
export function usd(amount: number): string {
  return `$${amount}`;
}

/** Months a yearly price saves over twelve monthly ones (2 for 40 vs 4 × 12). */
export function monthsFree(plan: Plan): number {
  if (!plan.monthlyUsd || plan.yearlyUsd === null) return 0;
  return Math.round((plan.monthlyUsd * 12 - plan.yearlyUsd) / plan.monthlyUsd);
}

/** "10 repos", "Unlimited repos", "1 member". */
export function limitLabel(limit: number | null, noun: string): string {
  return limit === null ? `Unlimited ${noun}s` : plural(limit, noun);
}

// --- Operations allowances: monthly LLM budget and abuse limits (docs/OPERATIONS.md) ---------

export interface PlanAllowances {
  /** Monthly LLM budget (estimated USD, src/lib/llm-budget.ts); null = none. */
  llmBudgetUsd: number | null;
  /** `POST /api/scan` uploads per UTC day; null = unlimited. */
  scanUploadsPerDay: number | null;
  /** Linked GitHub App installations; null = unlimited. */
  githubInstallations: number | null;
}

export const PLAN_ALLOWANCES: Readonly<Record<PlanId, PlanAllowances>> = {
  free: { llmBudgetUsd: 0.5, scanUploadsPerDay: 20, githubInstallations: 1 },
  pro: { llmBudgetUsd: 3, scanUploadsPerDay: 200, githubInstallations: 5 },
  team: { llmBudgetUsd: 10, scanUploadsPerDay: 1000, githubInstallations: null },
  unlimited: { llmBudgetUsd: null, scanUploadsPerDay: null, githubInstallations: null },
};

/** A per-plan allowance that only the hosted service enforces; null = unlimited. */
export function planAllowance(
  plan: PlanId,
  key: "scanUploadsPerDay" | "githubInstallations",
  { cloud }: { cloud: boolean }
): number | null {
  return cloud ? PLAN_ALLOWANCES[plan][key] : null;
}
