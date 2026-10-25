import { describe, expect, it } from "vitest";

import { isSourceDue, onlyDueSources } from "./collect";

describe("isSourceDue", () => {
  const now = new Date("2026-10-21T12:00:05Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

  it("fetches security sources every hourly run", () => {
    expect(isSourceDue({ class: "security", lastFetchedAt: hoursAgo(1) }, now)).toBe(true);
  });

  it("fetches the others about every 6 hours, never-fetched ones at once", () => {
    expect(isSourceDue({ class: "news", lastFetchedAt: null }, now)).toBe(true);
    expect(isSourceDue({ class: "releases", lastFetchedAt: hoursAgo(5) }, now)).toBe(false);
    // The previous fetch finished a few seconds after its run started: still due.
    expect(
      isSourceDue({ class: "news", lastFetchedAt: new Date("2026-10-21T06:00:09Z") }, now)
    ).toBe(true);
  });

  it("applies the cadence only to scheduled runs", () => {
    expect(onlyDueSources({ due: true })).toBe(true);
    expect(onlyDueSources({})).toBe(false);
    expect(onlyDueSources(null)).toBe(false);
  });
});
