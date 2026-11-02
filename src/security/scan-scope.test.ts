import { describe, expect, it } from "vitest";

import {
  alertKey,
  orgSecurityScanKey,
  planScanResolution,
  securityScanScope,
  type PlannedQuery,
  type StackDependency,
} from "./plan";

const dep = (repoId: string, over: Partial<StackDependency> = {}): StackDependency => ({
  orgId: "org-a",
  repoId,
  repoName: repoId,
  packageId: "pkg",
  ecosystem: "npm",
  name: "lodash",
  version: "4.17.21",
  direct: true,
  ...over,
});
const query = (dependents: StackDependency[], over: Partial<PlannedQuery> = {}): PlannedQuery => ({
  key: "lodash@4.17.21",
  ecosystem: "npm",
  name: "lodash",
  version: "4.17.21",
  packageId: "pkg",
  direct: true,
  dependents,
  ...over,
});
const alert = (id: string, repoId: string, packageId = "pkg") => ({
  id,
  advisoryId: "adv",
  repoId,
  packageId,
});

describe("securityScanScope", () => {
  it("reads the re-check's org and manual flag, and nothing else", () => {
    expect(securityScanScope({ orgId: "org-a", manual: true })).toEqual({
      orgId: "org-a",
      manual: true,
    });
    for (const payload of [{}, null, [], "org-a", { orgId: "" }, { orgId: 3, manual: "yes" }]) {
      expect(securityScanScope(payload)).toEqual({ orgId: null, manual: false });
    }
    expect(orgSecurityScanKey("org-a")).toBe("security-scan:org:org-a");
  });
});

describe("planScanResolution", () => {
  it("resolves an open alert whose stored version OSV no longer reports", () => {
    expect(
      planScanResolution([alert("a1", "r1")], [query([dep("r1")])], new Set(), new Set())
    ).toEqual(["a1"]);
  });

  it("keeps alerts OSV still reports, unknown answers and unasked packages open", () => {
    const queries = [query([dep("r1"), dep("r2")])];
    expect(
      planScanResolution(
        [alert("a1", "r1"), alert("a2", "r2"), alert("a3", "r3"), alert("a4", "r1", "other")],
        queries,
        new Set([alertKey("adv", "r1")]),
        new Set(["r2"])
      )
    ).toEqual([]);
  });

  it("never resolves from a requirement OSV cannot place", () => {
    const queries = [
      query([dep("r1")]),
      query([dep("r1", { constraint: true })], { constraint: true }),
    ];
    expect(planScanResolution([alert("a1", "r1")], queries, new Set(), new Set())).toEqual([]);
  });

  it("never resolves a GitHub Actions alert: a failed tag lookup drops its hit", () => {
    const queries = [
      query([dep("r1", { ecosystem: "GitHub Actions" })], {
        ecosystem: "GitHub Actions",
        name: "actions/checkout",
      }),
    ];
    expect(planScanResolution([alert("a1", "r1")], queries, new Set(), new Set())).toEqual([]);
  });
});
