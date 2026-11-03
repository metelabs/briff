import { describe, expect, it } from "vitest";

import {
  budgetPercent,
  llmBudgetFor,
  monthKey,
  monthStart,
  overBudget,
  previousMonthStart,
  reachedThreshold,
  utcDay,
} from "./llm-budget";
import { PLAN_ALLOWANCES, planAllowance } from "./plans";

describe("LLM budget", () => {
  it("takes the plan's budget, the admin's value instead, and none self-hosted", () => {
    expect(llmBudgetFor({ plan: "free", llmBudgetUsd: null }, { cloud: true })).toBe(0.5);
    expect(llmBudgetFor({ plan: "pro", llmBudgetUsd: null }, { cloud: true })).toBe(3);
    expect(llmBudgetFor({ plan: "team", llmBudgetUsd: null }, { cloud: true })).toBe(10);
    expect(llmBudgetFor({ plan: "unlimited", llmBudgetUsd: null }, { cloud: true })).toBeNull();
    // An override replaces the plan's value, lower or higher, and gives Unlimited a cap.
    expect(llmBudgetFor({ plan: "team", llmBudgetUsd: 1 }, { cloud: true })).toBe(1);
    expect(llmBudgetFor({ plan: "unlimited", llmBudgetUsd: 25 }, { cloud: true })).toBe(25);
    expect(llmBudgetFor({ plan: "free", llmBudgetUsd: 2 }, { cloud: false })).toBeNull();
  });

  it("switches to economy at the budget and reports 80 / 100 % thresholds", () => {
    expect(overBudget(2.99, 3)).toBe(false);
    expect(overBudget(3, 3)).toBe(true);
    expect(overBudget(100, null)).toBe(false);
    expect(reachedThreshold(2.39, 3)).toBe(0);
    expect(reachedThreshold(2.4, 3)).toBe(80);
    expect(reachedThreshold(3.5, 3)).toBe(100);
    expect(reachedThreshold(5, null)).toBe(0);
    expect(reachedThreshold(0, 0)).toBe(0);
    expect(reachedThreshold(0.01, 0)).toBe(100);
    expect(budgetPercent(2.4, 3)).toBe(80);
    expect(budgetPercent(9999, 1)).toBe(999);
  });

  it("works in UTC calendar months and days", () => {
    const now = new Date("2026-01-31T23:30:00Z");
    expect(monthStart(now).toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(previousMonthStart(now).toISOString()).toBe("2025-12-01T00:00:00.000Z");
    expect(utcDay(now).toISOString()).toBe("2026-01-31T00:00:00.000Z");
    expect(monthKey(now)).toBe("2026-01");
  });

  it("enforces scan and installation allowances on the hosted service only", () => {
    expect(planAllowance("free", "scanUploadsPerDay", { cloud: true })).toBe(20);
    expect(planAllowance("pro", "scanUploadsPerDay", { cloud: true })).toBe(200);
    expect(planAllowance("team", "scanUploadsPerDay", { cloud: true })).toBe(1000);
    expect(planAllowance("unlimited", "scanUploadsPerDay", { cloud: true })).toBeNull();
    expect(planAllowance("free", "githubInstallations", { cloud: true })).toBe(1);
    expect(planAllowance("pro", "githubInstallations", { cloud: true })).toBe(5);
    expect(planAllowance("team", "githubInstallations", { cloud: true })).toBeNull();
    expect(planAllowance("free", "githubInstallations", { cloud: false })).toBeNull();
    expect(PLAN_ALLOWANCES.free.llmBudgetUsd).toBe(0.5);
  });
});
