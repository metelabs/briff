import { describe, expect, it } from "vitest";

import { matchItem, stackPackageKey, type OrgStack } from "@/lib/match/matcher";
import { computeDrift } from "@/pipeline/stack-drift";
import { MANUAL_RUNTIME_SOURCE } from "@/pipeline/runtime-fixes";
import { planAlertResolution } from "@/security/resolution";

import {
  cleanSelections,
  MANUAL_SOURCE,
  manualStackRows,
  selectionsFromRows,
} from "./manual-stack";

describe("cleanSelections", () => {
  it("normalises names and versions and keeps the last of duplicates", () => {
    const res = cleanSelections([
      { kind: "runtime", name: "node", version: "v22" },
      { kind: "package", ecosystem: "PyPI", name: "Django", version: "" },
      { kind: "package", ecosystem: "npm", name: "react", version: "18.3.1" },
      { kind: "package", ecosystem: "npm", name: "react", version: "any" },
      { kind: "tool", name: "Dokploy/dokploy" },
    ]);
    expect(res).toEqual({
      ok: true,
      items: [
        { kind: "runtime", name: "node", version: "22" },
        { kind: "package", ecosystem: "PyPI", name: "django" },
        { kind: "package", ecosystem: "npm", name: "react" },
        { kind: "tool", name: "Dokploy/dokploy" },
      ],
    });
  });

  it("refuses unknown runtimes, bad names and bad versions with a sentence", () => {
    expect(cleanSelections([{ kind: "runtime", name: "cobol" }])).toMatchObject({ ok: false });
    expect(cleanSelections([{ kind: "runtime", name: "node", version: "latest" }])).toEqual({
      ok: false,
      message: "node: use a major version like 22 or 8.3.",
    });
    expect(
      cleanSelections([{ kind: "package", ecosystem: "npm", name: "Bad Name" }])
    ).toMatchObject({ ok: false });
    expect(
      cleanSelections([{ kind: "package", ecosystem: "GitHub Actions", name: "actions/checkout" }])
    ).toMatchObject({ ok: false });
    expect(cleanSelections([{ kind: "tool", name: "not-a-repo" }])).toMatchObject({ ok: false });
  });
});

describe("manualStackRows", () => {
  const rows = manualStackRows([
    { kind: "runtime", name: "node", version: "22" },
    { kind: "runtime", name: "redis" },
    { kind: "package", ecosystem: "npm", name: "react" },
    { kind: "package", ecosystem: "npm", name: "next", version: "15.2.3" },
    { kind: "package", ecosystem: "PyPI", name: "django", version: ">=5.0" },
    { kind: "tool", name: "Dokploy/dokploy" },
  ]);

  it("stores runtimes as manual rows; without a version they are never judged", () => {
    expect(MANUAL_SOURCE).toBe(MANUAL_RUNTIME_SOURCE);
    expect(rows.runtimes).toEqual([
      {
        name: "node",
        version: "22",
        normalized: "22",
        source: "manual",
        unresolved: false,
        constraint: false,
      },
      {
        name: "redis",
        version: "*",
        normalized: null,
        source: "manual",
        unresolved: false,
        constraint: true,
      },
    ]);
  });

  it("stores a package without a version or with a range as a requirement row", () => {
    const by = new Map(rows.dependencies.map((d) => [d.name, d]));
    expect(by.get("react")).toMatchObject({
      version: "*",
      constraint: true,
      unresolved: true,
      direct: true,
    });
    expect(by.get("django")).toMatchObject({
      version: ">=5.0",
      constraint: true,
      unresolved: true,
    });
    expect(by.get("next")).toMatchObject({
      version: "15.2.3",
      constraint: false,
      unresolved: false,
    });
    expect(by.get("Dokploy/dokploy")).toMatchObject({
      ecosystem: "GitHub",
      version: "*",
      unresolved: true,
    });
  });

  it("reads stored rows back as the picker's selections", () => {
    expect(
      selectionsFromRows(
        rows.dependencies.map((d) => ({
          ecosystem: d.ecosystem,
          name: d.name,
          version: d.version,
        })),
        rows.runtimes
      )
    ).toEqual([
      { kind: "runtime", name: "node", version: "22" },
      { kind: "runtime", name: "redis" },
      { kind: "package", ecosystem: "npm", name: "react" },
      { kind: "package", ecosystem: "npm", name: "next", version: "15.2.3" },
      { kind: "package", ecosystem: "PyPI", name: "django", version: ">=5.0" },
      { kind: "tool", name: "Dokploy/dokploy" },
    ]);
  });
});

describe("a `*` requirement row", () => {
  const stack: OrgStack = {
    orgId: "o1",
    packages: new Map([
      [
        stackPackageKey("npm", "react"),
        {
          packageId: "p-react",
          ecosystem: "npm",
          name: "react",
          direct: true,
          repoIds: new Set(["stack-1"]),
          serviceKey: null,
        },
      ],
    ]),
    packagesByFeed: new Map([["https://github.com/facebook/react/releases.atom", ["react"]]]),
    services: new Map(),
    runtimes: new Map(),
    traits: new Set(),
  };

  it("is matched by the package's release and security items", () => {
    const match = matchItem(
      { title: "v19.2.1 (security fix)", rawText: "" },
      {
        kind: "github_releases",
        url: "https://github.com/facebook/react/releases.atom",
        serviceKey: null,
        traits: [],
        runtime: null,
      },
      stack
    );
    expect(match).toMatchObject({ packageId: "p-react", repoIds: ["stack-1"] });
  });

  it("is never compared: no drift verdict and no alert resolution from it", () => {
    const [card] = computeDrift({
      asOf: new Date("2026-11-16"),
      repos: [{ key: "stack-1", name: "My stack" }],
      runtimes: [],
      dependencies: [
        {
          repo: "stack-1",
          ecosystem: "npm",
          packageName: "react",
          installedVersion: "*",
          unresolved: true,
          latestVersion: "19.2.1",
        },
      ],
    });
    expect(card.entries.every((e) => e.status === "unknown" || e.status === "current")).toBe(true);
    expect(card.entries.some((e) => e.status === "major" || e.status === "minor")).toBe(false);

    const plan = planAlertResolution(
      [
        {
          id: "a1",
          resolvedAt: null,
          packageId: "p-react",
          ecosystem: "npm",
          packageName: "react",
          affected: [{ type: "SEMVER", events: [{ introduced: "19.0.0" }, { fixed: "19.0.1" }] }],
          covered: [{ ecosystem: "npm", name: "react" }],
        },
      ],
      new Set(["p-react"]),
      true,
      [
        {
          packageId: "p-react",
          ecosystem: "npm",
          name: "react",
          version: "*",
          unresolved: true,
          constraint: true,
        },
      ]
    );
    expect(plan.resolve).toEqual([]);
  });
});
