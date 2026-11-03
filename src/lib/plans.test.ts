import { describe, expect, it } from "vitest";

import {
  atLimit,
  limitLabel,
  limitsFor,
  monthsFree,
  nextPlan,
  PLAN_IDS,
  PLANS,
  PRICED_PLANS,
  teamFeaturePlan,
  type PlanId,
} from "./plans";

const cloud = { cloud: true };
const row = (plan: PlanId, repoLimit: number | null = null, streamLimit: number | null = null) => ({
  plan,
  repoLimit,
  streamLimit,
});

describe("limitsFor", () => {
  it("takes each plan's limits when there is no override", () => {
    expect(limitsFor(row("free"), cloud)).toEqual({
      plan: "free",
      repoLimit: 10,
      streamLimit: 2,
      memberLimit: 1,
      deliveryTargets: 0,
      auditExport: false,
    });
    expect(limitsFor(row("pro"), cloud)).toEqual({
      plan: "pro",
      repoLimit: 50,
      streamLimit: 10,
      memberLimit: 3,
      deliveryTargets: 0,
      auditExport: false,
    });
    expect(limitsFor(row("team"), cloud)).toEqual({
      plan: "team",
      repoLimit: null,
      streamLimit: null,
      memberLimit: 10,
      deliveryTargets: null,
      auditExport: true,
    });
    expect(limitsFor(row("unlimited"), cloud)).toEqual({
      plan: "unlimited",
      repoLimit: null,
      streamLimit: null,
      memberLimit: null,
      deliveryTargets: null,
      auditExport: true,
    });
  });

  it("lets an override raise a limit, never lower it, and never cap an unlimited one", () => {
    expect(limitsFor(row("free", 25, 5), cloud)).toMatchObject({ repoLimit: 25, streamLimit: 5 });
    expect(limitsFor(row("free", 25), cloud)).toMatchObject({ repoLimit: 25, streamLimit: 2 });
    expect(limitsFor(row("pro", 25, 3), cloud)).toMatchObject({ repoLimit: 50, streamLimit: 10 });
    expect(limitsFor(row("pro", 80), cloud)).toMatchObject({ repoLimit: 80, streamLimit: 10 });
    expect(limitsFor(row("team", 80, 4), cloud)).toMatchObject({
      repoLimit: null,
      streamLimit: null,
    });
    expect(limitsFor(row("unlimited", 5, 1), cloud)).toMatchObject({
      repoLimit: null,
      streamLimit: null,
    });
  });

  it("treats every org on a self-hosted instance as unlimited, whatever its columns say", () => {
    for (const plan of PLAN_IDS)
      for (const override of [null, 1, 500])
        expect(limitsFor(row(plan, override, override), { cloud: false })).toEqual({
          plan: "unlimited",
          repoLimit: null,
          streamLimit: null,
          memberLimit: null,
          deliveryTargets: null,
          auditExport: true,
        });
  });
});

describe("Team features", () => {
  it("are Team's alone among the sold plans and listed as its extras", () => {
    expect(PRICED_PLANS.filter((p) => p.deliveryTargets !== 0).map((p) => p.id)).toEqual(["team"]);
    expect(PRICED_PLANS.filter((p) => p.auditExport).map((p) => p.id)).toEqual(["team"]);
    expect(PLANS.free.extras).toEqual([]);
    expect(PLANS.pro.extras).toEqual([]);
    expect(PLANS.team.extras).toEqual([
      "Slack and webhook delivery",
      "Audit log export",
      "Priority support (1 business day)",
    ]);
    expect(teamFeaturePlan().id).toBe("team");
  });
});

describe("plan table helpers", () => {
  it("prices yearly at two months free and lists only the sold plans", () => {
    expect(PRICED_PLANS.map((p) => p.id)).toEqual(["free", "pro", "team"]);
    expect(monthsFree(PLANS.pro)).toBe(2);
    expect(monthsFree(PLANS.team)).toBe(2);
    expect(monthsFree(PLANS.free)).toBe(0);
  });

  // List prices since 3 Nov 2026 (docs/BILLING.md "Price history"); Paddle's prices must match.
  it("lists Pro at $4 / $40 and Team at $12 / $120", () => {
    expect(PRICED_PLANS.map((p) => [p.id, p.monthlyUsd, p.yearlyUsd])).toEqual([
      ["free", 0, 0],
      ["pro", 4, 40],
      ["team", 12, 120],
    ]);
  });

  it("names the next plan up, and none past Team or for Unlimited", () => {
    expect(nextPlan("free")?.id).toBe("pro");
    expect(nextPlan("pro")?.id).toBe("team");
    expect(nextPlan("team")).toBeNull();
    expect(nextPlan("unlimited")).toBeNull();
  });

  it("reads null as unlimited", () => {
    expect(atLimit(10, 10)).toBe(true);
    expect(atLimit(9, 10)).toBe(false);
    expect(atLimit(10_000, null)).toBe(false);
    expect(limitLabel(null, "repo")).toBe("Unlimited repos");
    expect(limitLabel(1, "member")).toBe("1 member");
    expect(limitLabel(50, "repo")).toBe("50 repos");
  });
});
