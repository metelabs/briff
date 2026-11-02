import { describe, expect, it } from "vitest";

import {
  alertSectionOf,
  fixHintFor,
  recentlyResolved,
  repoConnections,
  resolvedSections,
  type ResolvedSectionRow,
  RECHECK_INTERVAL_MS,
  recheckWaitMs,
  resolvedSince,
} from "./alert-sections";

const weekStart = new Date("2026-10-26T00:00:00Z");

describe("alertSectionOf", () => {
  it("splits new alerts at the week start and keeps backlog apart", () => {
    const alert = (kind: string, createdAt: string) => ({ kind, createdAt: new Date(createdAt) });
    expect(alertSectionOf(alert("new", "2026-10-27T08:00:00Z"), weekStart)).toBe("this-week");
    expect(alertSectionOf(alert("new", "2026-10-20T00:00:00Z"), weekStart)).toBe("earlier");
    expect(alertSectionOf(alert("backlog", "2026-10-27T08:00:00Z"), weekStart)).toBe("backlog");
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

describe("Resolved section", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  const lastVisit = new Date("2026-10-31T00:00:00Z");
  let seq = 0;
  const resolved = (
    pkg: string,
    repo: string,
    at: string | null,
    over: Partial<ResolvedSectionRow> = {}
  ): ResolvedSectionRow => ({
    resolvedAt: at === null ? null : new Date(at),
    resolvedBy: "briff_scan",
    repoId: `id-${repo}`,
    repo: { name: repo },
    advisory: {
      osvId: `GHSA-${pkg}-${++seq}`,
      severity: "MODERATE",
      package: { name: pkg, ecosystem: "RubyGems" },
    },
    ...over,
  });

  // Production had four alerts resolved this week (two advisories of one package in two
  // repos) and showed one card: the counter and the section must count the same alerts.
  const week = [
    resolved("nokogiri", "shop", "2026-11-01T10:00:00Z"),
    resolved("nokogiri", "admin", "2026-11-01T12:00:00Z", { resolvedBy: "security_scan" }),
    resolved("nokogiri", "shop", "2026-10-30T09:00:00Z"),
    resolved("rack", "shop", "2026-10-26T00:00:00Z", { resolvedBy: null }),
  ];
  const before = [
    resolved("rack", "admin", "2026-10-25T23:59:00Z"),
    resolved("puma", "shop", "2026-10-10T10:00:00Z"),
  ];
  const rows = recentlyResolved(
    [
      ...week,
      ...before,
      resolved("old", "shop", "2026-09-20T10:00:00Z"),
      resolved("open", "shop", null),
    ],
    now
  );

  it("lists one card per alert the counter counts, and nothing else, this week", () => {
    const sections = resolvedSections(rows, weekStart, lastVisit);
    expect(resolvedSince(rows, weekStart)).toBe(4);
    expect(sections.thisWeek).toHaveLength(resolvedSince(rows, weekStart));
    expect(new Set(sections.thisWeek.map((a) => a.osvId))).toEqual(
      new Set(week.map((r) => r.advisory.osvId))
    );
  });

  it("keeps the counter and the cards equal for any week start", () => {
    for (const start of ["2026-10-19", "2026-10-26", "2026-11-01T11:00:00Z", "2026-11-02"]) {
      const at = new Date(start);
      expect(resolvedSections(rows, at, null).thisWeek).toHaveLength(resolvedSince(rows, at));
    }
  });

  it("puts older resolutions inside the 30-day window under Earlier", () => {
    const { earlier } = resolvedSections(rows, weekStart, lastVisit);
    expect(earlier.map((a) => [a.packageName, a.repo])).toEqual([
      ["rack", "admin"],
      ["puma", "shop"],
    ]);
  });

  it("orders latest first and marks what was resolved since the last visit", () => {
    const { thisWeek } = resolvedSections(rows, weekStart, lastVisit);
    expect(
      thisWeek.map((a) => [a.packageName, a.repo, a.cause, a.sinceLastVisit, a.severity])
    ).toEqual([
      ["nokogiri", "admin", "security-scan re-check", true, "MODERATE"],
      ["nokogiri", "shop", "newer upload from briff-scan", true, "MODERATE"],
      ["nokogiri", "shop", "newer upload from briff-scan", false, "MODERATE"],
      ["rack", "shop", "a later scan", false, "MODERATE"],
    ]);
    expect(thisWeek[0].ecosystem).toBe("RubyGems");
    expect(resolvedSections(rows, weekStart, null).thisWeek.some((a) => a.sinceLastVisit)).toBe(
      false
    );
  });

  it("keys each card by advisory and repo id, so same-named repos stay two cards", () => {
    const advisory = {
      osvId: "GHSA-same",
      severity: "HIGH",
      package: { name: "next", ecosystem: "npm" },
    };
    const { thisWeek } = resolvedSections(
      [
        resolved("next", "web", "2026-11-01T10:00:00Z", { repoId: "local-web", advisory }),
        resolved("next", "web", "2026-11-01T10:00:00Z", { repoId: "github-web", advisory }),
      ],
      weekStart,
      null
    );
    expect(new Set(thisWeek.map((a) => a.key)).size).toBe(2);
  });

  it("tags only non-npm ecosystems and labels a missing severity", () => {
    const [npm] = resolvedSections(
      [
        resolved("requests", "web", "2026-11-01T10:00:00Z", {
          advisory: {
            osvId: "GHSA-x",
            severity: null,
            package: { name: "requests", ecosystem: "npm" },
          },
        }),
      ],
      weekStart,
      null
    ).thisWeek;
    expect(npm.ecosystem).toBeUndefined();
    expect(npm.severity).toBe("UNKNOWN");
  });
});

describe("fixHintFor", () => {
  const connections = repoConnections([
    { name: "web", githubInstallationId: "inst-1" },
    { name: "shop", githubInstallationId: null },
    { name: "both", githubInstallationId: "inst-1" },
    { name: "both", githubInstallationId: null },
  ]);

  it("names how each package's repos report a fix", () => {
    expect(fixHintFor(["web"], connections)).toBe("app");
    expect(fixHintFor(["shop"], connections)).toBe("scanner");
    expect(fixHintFor(["web", "shop"], connections)).toBe("mixed");
    expect(fixHintFor(["both"], connections)).toBe("mixed");
    expect(fixHintFor(["unknown"], connections)).toBeNull();
  });
});
