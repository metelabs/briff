import { describe, expect, it } from "vitest";

import { alertGroupsOf, severityTotals, type AlertGroupRow } from "./alert-groups";

const wording = {
  noLineFix: "no fix on the installed release line",
  fixedIn: "Fixed in",
  transitive: "update the packages that pull it in",
};

function range(fixed: string, introduced = "0") {
  return [{ type: "SEMVER", events: [{ introduced }, { fixed }] }];
}

function row(
  repo: string,
  pkg: string,
  osvId: string,
  opts: {
    severity?: string | null;
    installed?: string[];
    direct?: boolean;
    affected?: unknown;
    fixedVersion?: string | null;
  } = {}
): AlertGroupRow {
  return {
    repo: { name: repo },
    installedVersions: opts.installed ?? [],
    direct: opts.direct ?? true,
    advisory: {
      osvId,
      severity: opts.severity === undefined ? "HIGH" : opts.severity,
      affected: opts.affected ?? [],
      fixedVersion: opts.fixedVersion ?? null,
      package: { name: pkg },
    },
  };
}

describe("alertGroupsOf", () => {
  it("groups per package with severity counts, most severe package first", () => {
    const groups = alertGroupsOf(
      [
        row("a", "axios", "GHSA-1", { severity: "MODERATE" }),
        row("a", "next", "GHSA-2", { severity: "HIGH" }),
        row("b", "next", "GHSA-3", { severity: "CRITICAL" }),
        row("b", "next", "GHSA-2", { severity: "HIGH" }),
      ],
      wording
    );
    expect(groups.map((g) => g.packageName)).toEqual(["next", "axios"]);
    expect(groups[0].severities).toEqual([
      ["CRITICAL", 1],
      ["HIGH", 1],
    ]);
    expect(groups[0].repos).toEqual(["a", "b"]);
    expect(severityTotals(groups).get("HIGH")).toBe(1);
  });

  it("gives one install per installed release line, never a higher major", () => {
    const affected = [
      { type: "SEMVER", events: [{ introduced: "14.0.0" }, { fixed: "14.2.35" }] },
      { type: "SEMVER", events: [{ introduced: "15.0.0" }, { fixed: "15.5.9" }] },
    ];
    const groups = alertGroupsOf(
      [
        row("orchid-hotel", "next", "GHSA-1", { installed: ["14.2.3"], affected }),
        row("bakery", "next", "GHSA-1", { installed: ["14.1.0"], affected }),
        row("budget", "next", "GHSA-1", { installed: ["15.1.0"], affected }),
      ],
      wording
    );
    expect(groups[0].fixes).toEqual([
      {
        repos: ["budget"],
        command: "npm i next@15.5.9",
        text: null,
        installs: [{ repo: "budget", name: "next", installed: ["15.1.0"], target: "15.5.9" }],
      },
      {
        repos: ["bakery", "orchid-hotel"],
        command: "npm i next@14.2.35",
        text: null,
        installs: [
          { repo: "bakery", name: "next", installed: ["14.1.0"], target: "14.2.35" },
          { repo: "orchid-hotel", name: "next", installed: ["14.2.3"], target: "14.2.35" },
        ],
      },
    ]);
  });

  it("says so when the installed line has no fix", () => {
    const affected = range("3.0.0");
    const [g] = alertGroupsOf(
      [row("orchid-hotel", "payload", "GHSA-1", { installed: ["2.30.0"], affected })],
      wording
    );
    expect(g.fixes).toEqual([
      {
        repos: ["orchid-hotel"],
        command: null,
        text: wording.noLineFix,
        installs: [{ repo: "orchid-hotel", name: "payload", installed: ["2.30.0"], target: null }],
      },
    ]);
  });

  it("points transitive-only repos at npm ls and keeps them apart from direct ones", () => {
    const [g] = alertGroupsOf(
      [
        row("briff", "undici", "GHSA-1", { direct: false, installed: ["6.0.0"] }),
        row("yard", "undici", "GHSA-1", {
          installed: ["6.0.0"],
          affected: range("6.21.2"),
        }),
      ],
      wording
    );
    expect(g.direct).toBe(true);
    expect(g.fixes).toEqual([
      {
        repos: ["yard"],
        command: "npm i undici@6.21.2",
        text: null,
        installs: [{ repo: "yard", name: "undici", installed: ["6.0.0"], target: "6.21.2" }],
      },
      {
        repos: ["briff"],
        command: "npm ls undici",
        text: wording.transitive,
        installs: [
          { repo: "briff", name: "undici", installed: ["6.0.0"], target: null, transitive: true },
        ],
      },
    ]);
  });

  it("falls back to the advisories' fixed lists only without an installed version", () => {
    const [g] = alertGroupsOf(
      [row("a", "ws", "GHSA-1", { fixedVersion: "8.17.1, 7.5.10" })],
      wording
    );
    expect(g.fixes).toEqual([
      {
        repos: ["a"],
        command: null,
        text: "Fixed in 8.17.1, 7.5.10",
        installs: [{ repo: "a", name: "ws", installed: [], target: null }],
      },
    ]);
  });

  it("adds nothing for a repo already past the fix", () => {
    const [g] = alertGroupsOf(
      [row("a", "ws", "GHSA-1", { installed: ["8.18.0"], affected: range("8.17.1") })],
      wording
    );
    expect(g.fixes).toEqual([]);
  });

  it("never builds an install command from a version the repo only has transitively", () => {
    const [g] = alertGroupsOf(
      [
        {
          ...row("a", "ws", "GHSA-1", {
            installed: ["8.18.0", "7.4.0"],
            affected: [
              { type: "SEMVER", events: [{ introduced: "7.0.0" }, { fixed: "7.5.10" }] },
              { type: "SEMVER", events: [{ introduced: "8.0.0" }, { fixed: "8.17.1" }] },
            ],
          }),
          directVersions: ["8.18.0"],
        },
      ],
      wording
    );
    expect(g.direct).toBe(false);
    expect(g.fixes).toEqual([
      {
        repos: ["a"],
        command: "npm ls ws",
        text: wording.transitive,
        installs: [{ repo: "a", name: "ws", installed: ["7.4.0"], target: null, transitive: true }],
      },
    ]);
  });

  it("names a direct repo without an installed version next to the fixed ones", () => {
    const [g] = alertGroupsOf(
      [
        row("budget", "next", "GHSA-1", {
          installed: ["15.1.0"],
          affected: range("15.5.9", "15.0.0"),
        }),
        row("garden.example", "next", "GHSA-1", { affected: range("15.5.9", "15.0.0") }),
      ],
      wording
    );
    expect(g.fixes.map((f) => f.installs)).toEqual([
      [{ repo: "budget", name: "next", installed: ["15.1.0"], target: "15.5.9" }],
      [{ repo: "garden.example", name: "next", installed: [], target: null }],
    ]);
  });
});

describe("alertGroupsOf per ecosystem", () => {
  const composerRow = (repo: string, opts: Parameters<typeof row>[3]) => {
    const r = row(repo, "acme/log", "GHSA-c1", opts);
    return {
      ...r,
      advisory: { ...r.advisory, package: { name: "acme/log", ecosystem: "Packagist" } },
    };
  };

  it("uses composer require and composer why, and keeps an npm package of the same name apart", () => {
    const groups = alertGroupsOf(
      [
        composerRow("acme/shop", { installed: ["3.0.2"], affected: range("3.0.3") }),
        composerRow("acme/tools", { installed: ["3.0.1"], direct: false }),
        row("acme/web", "acme/log", "GHSA-n1", { installed: ["1.0.0"], affected: range("1.0.1") }),
      ],
      wording
    );
    const composer = groups.find((g) => g.ecosystem === "Packagist");
    expect(composer?.fixes.map((f) => [f.repos, f.command])).toEqual([
      [["acme/shop"], "composer require acme/log:^3.0.3"],
      [["acme/tools"], "composer why acme/log"],
    ]);
    const dev = alertGroupsOf(
      [
        {
          ...composerRow("acme/shop", { installed: ["3.0.2"], affected: range("3.0.3") }),
          dev: true,
        },
      ],
      wording
    );
    expect(dev[0].fixes.map((f) => f.command)).toEqual(["composer require --dev acme/log:^3.0.3"]);
    const npm = groups.find((g) => g.ecosystem === undefined);
    expect(npm?.fixes.map((f) => f.command)).toEqual(["npm i acme/log@1.0.1"]);
  });
});

describe("alertGroupsOf for PyPI", () => {
  const pyRow = (
    repo: string,
    manager: "uv" | "poetry" | undefined,
    opts: Parameters<typeof row>[3]
  ) => {
    const r = row(repo, "acme-http", "GHSA-p1", opts);
    return {
      ...r,
      ...(manager ? { manager } : {}),
      advisory: { ...r.advisory, package: { name: "acme-http", ecosystem: "PyPI" } },
    };
  };

  it("gives each tool its own command on a line and the uv tree advice to uv-only transitive repos", () => {
    const [g] = alertGroupsOf(
      [
        pyRow("acme/jobs", "uv", { installed: ["2.31.0"], affected: range("2.32.0") }),
        pyRow("acme/api", "poetry", { installed: ["2.30.0"], affected: range("2.32.0") }),
        pyRow("acme/worker", "uv", { installed: ["2.31.0"], direct: false }),
      ],
      wording
    );
    expect(g.fixes.map((f) => [f.repos, f.command])).toEqual([
      [["acme/api"], "poetry add acme-http@2.32.0"],
      [["acme/jobs"], "uv add acme-http==2.32.0"],
      [["acme/worker"], "uv tree --invert --package acme-http"],
    ]);
  });
});

describe("alertGroupsOf with two declarations of one line in a repo", () => {
  it("updates the declaration of the affected version only", () => {
    const r = row("acme/jobs", "acme-probe", "GHSA-p2", {
      installed: ["1.0.0", "1.0.1"],
      affected: [{ type: "SEMVER", events: [{ introduced: "1.0.1" }, { fixed: "1.0.2" }] }],
    });
    const [g] = alertGroupsOf(
      [
        {
          ...r,
          advisory: { ...r.advisory, package: { name: "acme-probe", ecosystem: "PyPI" } },
          declarations: {
            "1.0.0": { manager: "uv", requirement: ".\tacme-probe; sys_platform == 'linux'" },
            "1.0.1": { manager: "uv", requirement: ".\tacme-probe; sys_platform == 'win32'" },
          },
        },
      ],
      wording
    );
    expect(g.fixes.map((f) => f.command)).toEqual([
      "uv add 'acme-probe==1.0.2; sys_platform == '\\''win32'\\'''",
    ]);
  });
});
