import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { osvVulnSchema, toAdvisoryFields } from "@/sources/osv";

import {
  alertKey,
  alertKindFor,
  backlogSummary,
  emailsImmediately,
  fixedFor,
  newAlertCandidates,
  planQueries,
  sortGroups,
  splitPending,
  splitTransitive,
  type AlertGroup,
  type StackDependency,
} from "./plan";

const dep = (over: Partial<StackDependency>): StackDependency => ({
  orgId: "org1",
  repoId: "r1",
  repoName: "garden",
  packageId: "p-next",
  ecosystem: "npm",
  name: "next",
  version: "15.1.3",
  direct: true,
  ...over,
});

describe("planQueries", () => {
  it("queries each package+version once, direct dependencies first", () => {
    const queries = planQueries([
      dep({ name: "a-transitive", packageId: "p-a", version: "1.0.0", direct: false }),
      dep({ repoId: "r1" }),
      dep({ repoId: "r2", repoName: "west", direct: false }),
      dep({ name: "next", version: "16.0.0", repoId: "r3", repoName: "briff" }),
    ]);
    expect(queries.map((q) => [q.key, q.direct, q.dependents.length])).toEqual([
      ["next@15.1.3", true, 2],
      ["next@16.0.0", true, 1],
      ["a-transitive@1.0.0", false, 1],
    ]);
  });
});

describe("newAlertCandidates (dedupe)", () => {
  const [query] = planQueries([dep({ repoId: "r1" }), dep({ repoId: "r2", repoName: "west" })]);

  it("creates one alert per advisory × repo", () => {
    const out = newAlertCandidates([{ query, advisoryIds: ["adv1", "adv1"] }], new Set());
    expect(out).toEqual([
      { orgId: "org1", advisoryId: "adv1", repoId: "r1", kind: "new" },
      { orgId: "org1", advisoryId: "adv1", repoId: "r2", kind: "new" },
    ]);
  });

  it("never re-creates an alert that exists; a newly affected repo triggers alone", () => {
    const existing = new Set([alertKey("adv1", "r1")]);
    expect(newAlertCandidates([{ query, advisoryIds: ["adv1"] }], existing)).toEqual([
      { orgId: "org1", advisoryId: "adv1", repoId: "r2", kind: "new" },
    ]);
    const all = new Set([alertKey("adv1", "r1"), alertKey("adv1", "r2")]);
    expect(newAlertCandidates([{ query, advisoryIds: ["adv1"] }], all)).toEqual([]);
  });
});

describe("fixedFor / sortGroups", () => {
  const vuln = osvVulnSchema.parse(
    JSON.parse(readFileSync(path.join(__dirname, "../sources/__fixtures__/osv-vuln.json"), "utf8"))
  );
  const fields = toAdvisoryFields(vuln, "next");
  const group = (over: Partial<AlertGroup>): AlertGroup => ({
    osvId: fields.osvId,
    packageName: "next",
    summary: fields.summary,
    severity: fields.severity,
    affected: fields.affected,
    fallbackFixed: fields.fixedVersion,
    repos: [{ name: "garden", installedVersion: "15.1.3", direct: true }],
    ...over,
  });

  it("names the fix on the branch of each installed version", () => {
    expect(fixedFor(group({}))).toBe("15.1.9");
    expect(
      fixedFor(
        group({
          repos: [
            { name: "a", installedVersion: "15.1.3", direct: true },
            { name: "b", installedVersion: "15.0.1", direct: true },
          ],
        })
      )
    ).toBe("15.1.9, 15.0.5");
    expect(
      fixedFor(group({ repos: [{ name: "a", installedVersion: "garbage", direct: true }] }))
    ).toBe("15.0.5, 15.1.9, 15.2.6");
  });

  it("orders direct before transitive, then by severity", () => {
    const sorted = sortGroups([
      group({
        osvId: "low",
        severity: "LOW",
        repos: [{ name: "a", installedVersion: "1", direct: true }],
      }),
      group({
        osvId: "crit-transitive",
        severity: "CRITICAL",
        repos: [{ name: "a", installedVersion: "1", direct: false }],
      }),
      group({
        osvId: "high",
        severity: "HIGH",
        repos: [{ name: "a", installedVersion: "1", direct: true }],
      }),
    ]);
    expect(sorted.map((g) => g.osvId)).toEqual(["high", "low", "crit-transitive"]);
  });
});

describe("alert kind", () => {
  const scanned = new Date("2026-10-20T04:00:00Z");

  it("is backlog until a repo's first security scan, and after it is re-added", () => {
    expect(alertKindFor({ securityScannedAt: null, includedChangedAt: null })).toBe("backlog");
    expect(
      alertKindFor({
        securityScannedAt: scanned,
        includedChangedAt: new Date("2026-10-20T10:00:00Z"),
      })
    ).toBe("backlog");
    expect(
      alertKindFor({
        securityScannedAt: scanned,
        includedChangedAt: new Date("2026-10-15T10:00:00Z"),
      })
    ).toBe("new");
    expect(alertKindFor({ securityScannedAt: scanned, includedChangedAt: null })).toBe("new");
  });

  it("stamps each candidate with its repo's kind", () => {
    const query = planQueries([dep({ repoId: "r1" }), dep({ repoId: "r2", repoName: "west" })])[0];
    const out = newAlertCandidates([{ query, advisoryIds: ["adv1"] }], new Set(), (repoId) =>
      repoId === "r1" ? "new" : "backlog"
    );
    expect(out.map((c) => [c.repoId, c.kind])).toEqual([
      ["r1", "new"],
      ["r2", "backlog"],
    ]);
  });
});

describe("same-day email threshold", () => {
  it("emails critical, high and unknown severity; holds moderate and low", () => {
    expect(emailsImmediately("CRITICAL")).toBe(true);
    expect(emailsImmediately("high")).toBe(true);
    expect(emailsImmediately(null)).toBe(true);
    expect(emailsImmediately("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H")).toBe(true);
    expect(emailsImmediately("MODERATE")).toBe(false);
    expect(emailsImmediately("MEDIUM")).toBe(false);
    expect(emailsImmediately("LOW")).toBe(false);
  });

  const pending = (
    kind: "new" | "backlog",
    severity: string | null,
    advisoryId: string,
    repo = "garden"
  ) => ({
    kind,
    advisoryId,
    severity,
    repo: { name: repo },
    advisory: { severity },
  });

  it("sends new critical/high alerts, summarises the backlog, holds the rest", () => {
    const live = [
      pending("new", "HIGH", "a1"),
      pending("new", "LOW", "a2"),
      pending("new", "MODERATE", "a3"),
      pending("backlog", "LOW", "b1", "briff"),
      pending("backlog", "CRITICAL", "b2", "briff"),
      pending("backlog", "CRITICAL", "b2", "mint-app"),
    ];
    const { urgent, backlog, held } = splitPending(live);
    expect(urgent.map((a) => a.advisoryId)).toEqual(["a1"]);
    expect(backlog).toHaveLength(3);
    expect(held).toBe(2);
    expect(backlogSummary(backlog)).toEqual({
      repos: ["briff", "mint-app"],
      advisories: 2,
      severe: 1,
    });
    expect(backlogSummary([])).toBeNull();
  });
});

describe("splitTransitive", () => {
  const group = (
    osvId: string,
    pkg: string,
    severity: string,
    direct: boolean,
    repo = "garden"
  ) => ({
    osvId,
    packageName: pkg,
    summary: null,
    severity,
    affected: [],
    fallbackFixed: null,
    repos: [{ name: repo, installedVersion: "1.0.0", direct }],
  });

  it("keeps direct advisories one each and merges transitive-only ones per package", () => {
    const { direct, transitive } = splitTransitive([
      group("G1", "undici", "LOW", false, "briff"),
      group("G2", "undici", "HIGH", false, "garden"),
      group("G3", "next", "HIGH", true),
      group("G4", "minimist", "CRITICAL", false),
    ]);
    expect(direct.map((g) => g.osvId)).toEqual(["G3"]);
    expect(transitive).toEqual([
      {
        packageName: "minimist",
        severity: "CRITICAL",
        osvIds: ["G4"],
        repos: [{ name: "garden", installedVersion: "1.0.0" }],
      },
      {
        packageName: "undici",
        severity: "HIGH",
        osvIds: ["G2", "G1"],
        repos: [
          { name: "briff", installedVersion: "1.0.0" },
          { name: "garden", installedVersion: "1.0.0" },
        ],
      },
    ]);
  });
});
