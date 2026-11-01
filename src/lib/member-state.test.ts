import { describe, expect, it } from "vitest";

import { needsOnboarding, unseenAlertsWhere } from "./member-state";

describe("needsOnboarding", () => {
  it("shows onboarding only on the first run", () => {
    expect(needsOnboarding(0, null)).toBe(true);
    expect(needsOnboarding(1, null)).toBe(false);
    expect(needsOnboarding(0, new Date("2026-10-20T10:00:00Z"))).toBe(false);
  });
});

describe("unseenAlertsWhere", () => {
  it("counts new-kind alerts created after the last visit to /alerts", () => {
    const seen = new Date("2026-10-22T08:00:00Z");
    expect(unseenAlertsWhere(seen)).toEqual({
      kind: "new",
      resolvedAt: null,
      createdAt: { gt: seen },
    });
  });

  it("counts every new-kind alert before the first visit, never backlog ones", () => {
    expect(unseenAlertsWhere(null)).toEqual({ kind: "new", resolvedAt: null });
  });
});
