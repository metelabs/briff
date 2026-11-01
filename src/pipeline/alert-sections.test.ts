import { describe, expect, it } from "vitest";

import {
  alertSectionOf,
  fixedSince,
  RECHECK_INTERVAL_MS,
  recheckWaitMs,
  resolvedSince,
  type ResolvedAlertRow,
} from "./alert-sections";

const weekStart = new Date("2026-10-26T00:00:00Z");
const row = (over: Partial<ResolvedAlertRow> & { pkg?: string; repoName?: string }) => {
  const { pkg = "lodash", repoName = "garden", ...rest } = over;
  return {
    kind: "new",
    createdAt: new Date("2026-10-27T08:00:00Z"),
    resolvedAt: new Date("2026-10-31T08:00:00Z"),
    repo: { name: repoName },
    advisory: { package: { name: pkg } },
    ...rest,
  };
};

describe("alertSectionOf", () => {
  it("splits new alerts at the week start and keeps backlog apart", () => {
    expect(alertSectionOf(row({}), weekStart)).toBe("this-week");
    expect(alertSectionOf(row({ createdAt: new Date("2026-10-20T00:00:00Z") }), weekStart)).toBe(
      "earlier"
    );
    expect(alertSectionOf(row({ kind: "backlog" }), weekStart)).toBe("backlog");
  });
});

describe("fixedSince", () => {
  const lastVisit = new Date("2026-10-30T00:00:00Z");

  it("lists packages resolved after the last visit per section, repos merged", () => {
    const fixed = fixedSince(
      [
        row({ repoName: "web" }),
        row({ repoName: "api" }),
        row({ pkg: "axios", kind: "backlog" }),
        row({ pkg: "old", resolvedAt: new Date("2026-10-29T00:00:00Z") }),
        row({ pkg: "open", resolvedAt: null }),
      ],
      lastVisit,
      weekStart
    );
    expect(fixed["this-week"]).toEqual([{ packageName: "lodash", repos: ["api", "web"] }]);
    expect(fixed.backlog).toEqual([{ packageName: "axios", repos: ["garden"] }]);
    expect(fixed.earlier).toEqual([]);
  });

  it("lists nothing before a first visit", () => {
    expect(fixedSince([row({})], null, weekStart)["this-week"]).toEqual([]);
  });
});

describe("resolvedSince", () => {
  it("counts alerts resolved since the week start", () => {
    expect(
      resolvedSince(
        [row({}), row({ resolvedAt: new Date("2026-10-25T23:00:00Z") }), row({ resolvedAt: null })],
        weekStart
      )
    ).toBe(1);
  });
});

describe("recheckWaitMs", () => {
  const now = new Date("2026-11-01T10:00:00Z");
  it("allows a re-check once the interval has passed", () => {
    expect(recheckWaitMs(null, now)).toBe(0);
    expect(recheckWaitMs(new Date(now.getTime() - RECHECK_INTERVAL_MS), now)).toBe(0);
    expect(recheckWaitMs(new Date(now.getTime() - 60_000), now)).toBe(RECHECK_INTERVAL_MS - 60_000);
  });
});
