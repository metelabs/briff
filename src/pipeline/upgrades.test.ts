import { describe, expect, it } from "vitest";

import type { RuntimeRow } from "./runtime-fixes";
import { W43_ALERT_FIXES } from "./__fixtures__/w43-security";
import {
  alignUpgrades,
  installedText,
  installTargets,
  packageUpgrades,
  parseUpgrades,
  releaseUpgrades,
  runtimeUpgrades,
  upgradeLine,
} from "./upgrades";

describe("packageUpgrades", () => {
  it("pairs each repo's installed versions with the fix for its release line", () => {
    expect(
      packageUpgrades("undici", null, [
        { repo: "budget", installed: "8.10.0", fix: "8.12.2" },
        { repo: "tracker", installed: "7.20.0", fix: "7.30.1" },
        { repo: "tracker", installed: "7.18.0", fix: "7.30.1" },
      ])
    ).toEqual([
      { repo: "budget", name: "undici", installed: ["8.10.0"], target: "8.12.2" },
      { repo: "tracker", name: "undici", installed: ["7.18.0", "7.20.0"], target: "7.30.1" },
    ]);
  });

  it("uses the newest release on the line like the fix command", () => {
    expect(
      packageUpgrades(
        "nodemailer",
        ["10.1.2", "10.1.7"],
        [{ repo: "briff", installed: "10.1.1", fix: "10.1.2" }]
      )[0].target
    ).toBe("10.1.7");
  });

  it("keeps transitive repos without a target and lists unknown repos", () => {
    expect(
      packageUpgrades(
        "undici",
        null,
        [{ repo: "briff", installed: "7.20.0", fix: "7.29.1", direct: false }],
        ["garden.example"]
      )
    ).toEqual([
      { repo: "briff", name: "undici", installed: ["7.20.0"], target: null, transitive: true },
      { repo: "garden.example", name: "undici", installed: [], target: null },
    ]);
  });

  it("lists other affected repos with their installed versions and no target", () => {
    const installs = new Map([
      ["briff", [{ version: "2.1.5", direct: false }]],
      ["sigma/forms-web", [{ version: "1.6.23", direct: true }]],
    ]);
    expect(
      packageUpgrades(
        "better-auth",
        null,
        [{ repo: "sigma/budget", installed: "1.4.9", fix: "1.7.12" }],
        ["briff", "sigma/forms-web", "yard"],
        (repo) => installs.get(repo) ?? []
      ).map(upgradeLine)
    ).toEqual([
      "briff: better-auth 2.1.5 (transitive)",
      "sigma/budget: better-auth 1.4.9 → 1.7.12",
      "sigma/forms-web: better-auth 1.6.23",
      "yard: better-auth installed version unknown",
    ]);
  });

  it("splits a repo's direct lines and its transitive version", () => {
    expect(
      packageUpgrades("undici", null, [
        { repo: "pantheon", installed: "8.10.0", fix: "8.12.3" },
        { repo: "pantheon", installed: "7.29.0", fix: "7.30.1", direct: false },
        { repo: "budget", installed: "7.20.0", fix: "7.30.1" },
        { repo: "budget", installed: "8.9.0", fix: "8.12.3" },
      ]).map(upgradeLine)
    ).toEqual([
      "budget: undici 7.20.0 → 7.30.1",
      "budget: undici 8.9.0 → 8.12.3",
      "pantheon: undici 8.10.0 → 8.12.3",
      "pantheon: undici 7.29.0 (transitive)",
    ]);
  });

  it("gives no target when there is no safe fix on the line", () => {
    expect(
      packageUpgrades("next", null, [
        { repo: "garden.example", installed: "15.5.4", fix: "16.0.7" },
      ])
    ).toEqual([{ repo: "garden.example", name: "next", installed: ["15.5.4"], target: null }]);
  });
});

const row = (over: Partial<RuntimeRow> & { repo: string }): RuntimeRow => ({
  name: "node",
  version: "22.17.0-alpine",
  normalized: "22.17.0",
  source: "Dockerfile",
  unresolved: false,
  image: "node",
  ...over,
});

describe("runtimeUpgrades", () => {
  const meta = { fixedVersions: ["22.23.4", "24.11.1"], lineSpecific: false, affectedLines: [] };
  const asOf = new Date("2026-10-20T00:00:00Z");

  it("names the row the action is about and the fixed version for its line", () => {
    expect(runtimeUpgrades("node", meta, [row({ repo: "garden.example" })], asOf)).toEqual([
      {
        repo: "garden.example",
        name: "node",
        installed: ["22.17.0"],
        source: "Dockerfile",
        target: "22.23.4",
        action: "move Dockerfile to node:22.23.4-alpine",
      },
    ]);
  });

  it("keeps each repo's own action, which a summarised item action no longer names", () => {
    const out = runtimeUpgrades(
      "node",
      meta,
      [
        row({ repo: "garden.example" }),
        row({ repo: "yard", version: "22.17.0", source: ".nvmrc", image: null }),
      ],
      asOf
    );
    expect(out.map((u) => [u.repo, u.action])).toEqual([
      ["garden.example", "move Dockerfile to node:22.23.4-alpine"],
      ["yard", "set node 22.23.4 in .nvmrc"],
    ]);
  });

  it("shows an engines range in its readable form", () => {
    const [u] = runtimeUpgrades(
      "node",
      meta,
      [
        row({
          repo: "briff",
          version: ">=20",
          normalized: "20",
          source: "package.json engines.node",
          image: null,
        }),
      ],
      asOf
    );
    expect(installedText(u)).toBe("node 20+ (package.json engines.node)");
  });

  it("has no per-repo action before fixed versions are known", () => {
    const pending = { ...meta, fixedVersions: [] };
    expect(
      runtimeUpgrades("node", pending, [row({ repo: "garden.example" })], asOf)[0]
    ).not.toHaveProperty("action");
  });

  it("says the version is unknown for an unresolved row", () => {
    const out = runtimeUpgrades(
      "node",
      meta,
      [row({ repo: "x", version: "${NODE_VERSION}", normalized: null, unresolved: true })],
      asOf
    );
    expect(out[0]).toMatchObject({ installed: [], target: null });
    expect(upgradeLine(out[0])).toBe("x runs node installed version unknown (Dockerfile)");
  });

  it("leaves out repos already past the fix", () => {
    expect(
      runtimeUpgrades(
        "node",
        meta,
        [row({ repo: "a", version: "22.23.4", normalized: "22.23.4" })],
        asOf
      )
    ).toEqual([]);
  });
});

describe("installTargets", () => {
  it("reads Cargo's precise destination rather than its installed selector", () => {
    expect(installTargets("cargo update -p tokio@1.24.1 --precise 1.24.2", "tokio")?.all).toBe(
      "1.24.2"
    );
    expect(installTargets("cargo update -p tokio --precise 1.24.2 (acme/api)", "tokio")).toEqual({
      all: null,
      byRepo: new Map([["acme/api", "1.24.2"]]),
    });
    expect(
      releaseUpgrades(
        "tokio",
        "cargo update -p tokio@1.24.1 --precise 1.24.2",
        ["1.24.1", "1.24.2"],
        ["acme/api"],
        () => ["1.24.1"],
        "crates.io"
      )[0].target
    ).toBe("1.24.2");
  });
  it("reads one version for every repo, or one per listed repo set", () => {
    expect(installTargets("npm i next@16.3.8", "next")).toEqual({
      all: "16.3.8",
      byRepo: new Map(),
    });
    const per = installTargets(
      "npm i undici@8.12.2 (budget, pantheon) · npm i undici@7.30.1 (tracker)",
      "undici"
    );
    expect(per?.byRepo.get("pantheon")).toBe("8.12.2");
    expect(per?.byRepo.get("tracker")).toBe("7.30.1");
    expect(installTargets("npm i @next/env@16.3.8", "next")).toBeNull();
    expect(installTargets("uv lock --upgrade-package acme-http==2.32.0", "acme-http")?.all).toBe(
      "2.32.0"
    );
    expect(installTargets("poetry add acme-http@2.32.0", "acme-http")?.all).toBe("2.32.0");
    expect(installTargets("composer require acme/log:^3.0.3 (acme/shop)", "acme/log")).toEqual({
      all: null,
      byRepo: new Map([["acme/shop", "3.0.3"]]),
    });
    expect(installTargets("Read the changelog", "next")).toBeNull();
  });
});

describe("releaseUpgrades", () => {
  it("lists every affected repo with its installed version, unknown when not on record", () => {
    const installed: Record<string, string[]> = { "bakery.example": ["15.2.3"] };
    expect(
      releaseUpgrades(
        "next",
        "npm i next@16.3.8",
        ["16.3.8"],
        ["briff", "bakery.example"],
        (r) => installed[r] ?? []
      ).map(upgradeLine)
    ).toEqual([
      "bakery.example: next 15.2.3 → 16.3.8",
      "briff: next installed version unknown → 16.3.8",
    ]);
  });

  it("never turns an upgrade to-do into a release on another line", () => {
    expect(
      releaseUpgrades("expo", "Upgrade when ready", ["55.0.1"], ["a"], () => ["54.0.3"]).map(
        upgradeLine
      )
    ).toEqual(["a: expo 54.0.3"]);
  });

  it("resolves an upgrade to-do per installed line from the item's releases", () => {
    expect(
      releaseUpgrades(
        "expo",
        "Upgrade when ready",
        ["55.0.1", "54.0.9", "54.0.7"],
        ["a", "b", "c"],
        (r) => ({ a: ["54.0.3"], b: ["55.0.0", "54.0.8"], c: [] })[r] ?? []
      ).map(upgradeLine)
    ).toEqual([
      "a: expo 54.0.3 → 54.0.9",
      "b: expo 54.0.8 → 54.0.9",
      "b: expo 55.0.0 → 55.0.1",
      "c: expo installed version unknown",
    ]);
  });

  it("ignores an install version the synthesis input never had", () => {
    expect(
      releaseUpgrades("next", "npm i next@16.3.99", ["16.3.8", "15.5.12"], ["a"], () => [
        "15.2.3",
      ]).map(upgradeLine)
    ).toEqual(["a: next 15.2.3 → 15.5.12"]);
    expect(
      releaseUpgrades("next", "npm i next@16.3.99", ["16.3.8"], ["a"], () => [])[0].target
    ).toBeNull();
  });
});

describe("upgradeLine", () => {
  it("writes runtimes as what the repo runs and where", () => {
    expect(
      upgradeLine({
        repo: "garden.example",
        name: "node",
        installed: ["22.17.0"],
        source: "Dockerfile",
        target: "22.23.4",
      })
    ).toBe("garden.example runs node 22.17.0 (Dockerfile) → 22.23.4");
    expect(
      installedText({
        repo: "b",
        name: "undici",
        installed: ["7.20.0"],
        target: null,
        transitive: true,
      })
    ).toBe("undici 7.20.0 (transitive)");
  });
});

describe("parseUpgrades", () => {
  it("keeps well-formed entries only", () => {
    expect(
      parseUpgrades([
        { repo: "a", name: "next", installed: ["15.2.3", 7], target: "16.3.8" },
        { repo: 1, name: "x" },
        "junk",
      ])
    ).toEqual([{ repo: "a", name: "next", installed: ["15.2.3"], target: "16.3.8" }]);
    expect(parseUpgrades(null)).toEqual([]);
  });

  it("keeps a stored per-repo action", () => {
    const action = "move Dockerfile to node:22.23.4-alpine";
    expect(
      parseUpgrades([{ repo: "a", name: "node", installed: [], target: "22.23.4", action }])[0]
    ).toMatchObject({ action });
  });
});

describe("runtimeUpgrades for every matched repo", () => {
  it("names repos past the fix and repos without a version instead of dropping them", () => {
    const meta = { fixedVersions: ["22.23.4"], lineSpecific: false, affectedLines: [] };
    const out = runtimeUpgrades(
      "node",
      meta,
      [
        row({ repo: "garden.example" }),
        row({ repo: "sigma/tracker", version: "22.23.4-bookworm-slim", normalized: "22.23.4" }),
      ],
      new Date("2026-10-20T00:00:00Z"),
      ["garden.example", "sigma/tracker", "yard"]
    );
    expect(out.map(upgradeLine)).toEqual([
      "garden.example runs node 22.17.0 (Dockerfile) → 22.23.4",
      "sigma/tracker runs node 22.23.4 (Dockerfile), not affected",
      "yard: node installed version unknown",
    ]);
  });
});

describe("alignUpgrades", () => {
  it("keeps the affected repos' lines, drops others and fills the missing ones", () => {
    const upgrades = [
      { repo: "clinic.example", name: "payload", installed: ["3.86.0"], target: "3.92.0" },
      { repo: "orchid-hotel", name: "payload", installed: ["3.85.1"], target: "3.92.0" },
    ];
    expect(alignUpgrades(upgrades, ["bakery.example", "clinic.example"]).map(upgradeLine)).toEqual([
      "bakery.example: payload installed version unknown",
      "clinic.example: payload 3.86.0 → 3.92.0",
    ]);
    expect(alignUpgrades([], ["bakery.example"])).toEqual([]);
  });
});

describe("packageUpgrades when one installed line has no fix (W43 nodemailer)", () => {
  it("keeps the target of the line that has one, as the fix command does", () => {
    const fixes = W43_ALERT_FIXES.get("nodemailer") ?? [];
    const rows = packageUpgrades("nodemailer", "10.1.2", fixes);
    expect(rows.map((r) => [r.repo, r.installed, r.target, r.transitive ?? false])).toEqual([
      ["briff", ["10.1.1"], "10.1.4", false],
      ["garden.example", ["9.0.3"], null, false],
      ["mint-app", ["6.9.15"], null, true],
      ["pantheon", ["7.0.11"], null, true],
      ["west.garden.example", ["9.0.3"], null, false],
    ]);
  });
});
