import { describe, expect, it } from "vitest";

import {
  alertSectionOf,
  fixedSince,
  fixHintFor,
  recentlyResolved,
  repoConnections,
  resolvedPackages,
  type ResolvedSectionRow,
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

describe("Resolved section", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  const resolved = (
    pkg: string,
    repo: string,
    at: string,
    over: Partial<ResolvedSectionRow> = {}
  ): ResolvedSectionRow => ({
    kind: "new",
    createdAt: new Date("2026-09-01T00:00:00Z"),
    resolvedAt: new Date(at),
    resolvedBy: "briff_scan",
    repo: { name: repo },
    advisory: { severity: "MODERATE", package: { name: pkg, ecosystem: "RubyGems" } },
    ...over,
  });

  it("keeps the last 30 days for both the section and the since-last-visit line", () => {
    const rows = [
      resolved("nokogiri", "shop", "2026-11-01T10:00:00Z"),
      resolved("rack", "shop", "2026-09-20T10:00:00Z"),
      { ...resolved("open", "shop", "2026-11-01T10:00:00Z"), resolvedAt: null },
    ];
    const recent = recentlyResolved(rows, now);
    expect(recent.map((r) => r.advisory.package.name)).toEqual(["nokogiri"]);
    const fixed = fixedSince(recent, new Date("2026-08-01T00:00:00Z"), weekStart);
    expect(fixed.earlier.map((p) => p.packageName)).toEqual(["nokogiri"]);
  });

  it("groups per package with repos, the worst severity, the latest time and every cause", () => {
    const packages = resolvedPackages([
      resolved("nokogiri", "shop", "2026-11-01T10:00:00Z"),
      resolved("nokogiri", "admin", "2026-11-01T12:00:00Z", {
        resolvedBy: "security_scan",
        advisory: { severity: "HIGH", package: { name: "nokogiri", ecosystem: "RubyGems" } },
      }),
      resolved("rack", "shop", "2026-10-30T09:00:00Z", { resolvedBy: null }),
    ]);
    expect(packages).toEqual([
      {
        packageName: "nokogiri",
        ecosystem: "RubyGems",
        repos: ["admin", "shop"],
        severity: "HIGH",
        resolvedAt: new Date("2026-11-01T12:00:00Z"),
        causes: ["newer upload from briff-scan", "security-scan re-check"],
      },
      {
        packageName: "rack",
        ecosystem: "RubyGems",
        repos: ["shop"],
        severity: "MODERATE",
        resolvedAt: new Date("2026-10-30T09:00:00Z"),
        causes: ["a later scan"],
      },
    ]);
  });

  it("keeps same-named packages from different ecosystems apart", () => {
    const packages = resolvedPackages([
      resolved("requests", "api", "2026-11-01T10:00:00Z", {
        advisory: { severity: "HIGH", package: { name: "requests", ecosystem: "PyPI" } },
      }),
      resolved("requests", "web", "2026-10-31T10:00:00Z", {
        advisory: { severity: "LOW", package: { name: "requests", ecosystem: "npm" } },
      }),
    ]);
    expect(packages.map((p) => [p.packageName, p.ecosystem, p.repos, p.severity])).toEqual([
      ["requests", "PyPI", ["api"], "HIGH"],
      ["requests", undefined, ["web"], "LOW"],
    ]);
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
