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
    });
    expect(limitsFor(row("pro"), cloud)).toEqual({
      plan: "pro",
      repoLimit: 50,
      streamLimit: 10,
      memberLimit: 3,
    });
    expect(limitsFor(row("team"), cloud)).toEqual({
      plan: "team",
      repoLimit: null,
      streamLimit: null,
      memberLimit: 10,
    });
    expect(limitsFor(row("unlimited"), cloud)).toEqual({
      plan: "unlimited",
      repoLimit: null,
      streamLimit: null,
      memberLimit: null,
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
        });
  });
});

describe("plan table helpers", () => {
  it("prices yearly at two months free and lists only the sold plans", () => {
    expect(PRICED_PLANS.map((p) => p.id)).toEqual(["free", "pro", "team"]);
    expect(monthsFree(PLANS.pro)).toBe(2);
    expect(monthsFree(PLANS.team)).toBe(2);
    expect(monthsFree(PLANS.free)).toBe(0);
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
