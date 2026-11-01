import { afterEach, describe, expect, it } from "vitest";

import { setLifecycleRows, type LifecycleRow } from "@/lib/runtime-eol";

import {
  compareStackRepos,
  computeDrift,
  eolTarget,
  judgeRuntime,
  packageEntry,
  repoUrgency,
  type StackRepo,
} from "./stack-drift";

const asOf = new Date("2026-10-23T00:00:00Z");
const repos = (...names: string[]) => names.map((name) => ({ key: name, name }));

afterEach(() => setLifecycleRows([]));

const NODE_ROWS: LifecycleRow[] = [
  {
    product: "node",
    cycle: "18",
    eol: "2025-04-30",
    latest: "18.20.8",
    lts: "2022-10-25",
    support: null,
  },
  {
    product: "node",
    cycle: "20",
    eol: "2026-04-30",
    latest: "20.19.4",
    lts: "2023-10-24",
    support: null,
  },
  {
    product: "node",
    cycle: "22",
    eol: "2027-04-30",
    latest: "22.23.4",
    lts: "2024-10-29",
    support: null,
  },
  { product: "node", cycle: "23", eol: "2025-06-01", latest: "23.11.1", lts: false, support: null },
  {
    product: "node",
    cycle: "24",
    eol: "2028-04-30",
    latest: "24.9.0",
    lts: "2025-10-28",
    support: null,
  },
];

describe("packageEntry", () => {
  it("is current at or past the latest version, without a target", () => {
    expect(packageEntry(["16.2.0"], "16.2.0")).toMatchObject({
      status: "current",
      version: "16.2.0",
      target: null,
    });
  });

  it("is minor behind on the same release line and names the latest in that line", () => {
    expect(packageEntry(["16.1.4"], "16.2.0")).toMatchObject({
      status: "minor",
      behind: 0,
      target: "Latest in your line: 16.2.0",
    });
  });

  it("counts majors behind, and minor lines below 1.0", () => {
    expect(packageEntry(["14.2.35"], "16.2.0")).toMatchObject({ status: "major", behind: 2 });
    expect(packageEntry(["0.4.0"], "0.5.1")).toMatchObject({ status: "major", behind: 1 });
  });

  it("never words a newer major as the step to take", () => {
    const entry = packageEntry(["14.2.35"], "16.2.0");
    expect(entry?.target).toBe("Newest release 16.2.0 is a major upgrade");
    expect(entry?.target).not.toMatch(/^(npm|move|upgrade to|install)/i);
  });

  it("keeps prerelease ordering: an rc is behind its release", () => {
    expect(packageEntry(["19.0.0-rc.1"], "19.0.0")).toMatchObject({ status: "minor" });
    expect(packageEntry(["19.0.0"], "19.0.0")).toMatchObject({ status: "current" });
  });

  it("judges the lowest installed version", () => {
    expect(packageEntry(["19.2.0", "18.3.1"], "19.2.0")).toMatchObject({
      version: "18.3.1",
      status: "major",
      behind: 1,
    });
  });

  it("does not judge without a latest version, and has no entry without an install", () => {
    expect(packageEntry(["5.9.3"], null)).toMatchObject({ status: "unknown", version: "5.9.3" });
    expect(packageEntry([], "1.0.0")).toBeNull();
  });
});

describe("judgeRuntime and eolTarget", () => {
  const node = (version: string, normalized: string | null = version, source = ".nvmrc") => ({
    version,
    normalized,
    source,
  });

  it("gives an end-of-life line the migration to the lowest supported line, with LTS and support end", () => {
    setLifecycleRows(NODE_ROWS);
    expect(judgeRuntime("node", node("18"), asOf)).toMatchObject({
      status: "eol",
      until: "2025-04-30",
      target: "Move to 22.x (LTS, supported until 2027-04)",
    });
    // 23 is past end of life too; the lowest supported line above it is 24, never 22.
    expect(eolTarget("node", "23", asOf)).toBe("Move to 24.x (LTS, supported until 2028-04)");
  });

  it("does not call a line LTS when its LTS start is after asOf", () => {
    setLifecycleRows(NODE_ROWS.map((r) => (r.cycle === "22" ? { ...r, lts: "2027-01-01" } : r)));
    expect(eolTarget("node", "18", asOf)).toBe("Move to 22.x (supported until 2027-04)");
  });

  it("works from the built-in table without LTS or latest data", () => {
    expect(judgeRuntime("node", node("18"), asOf)).toMatchObject({
      status: "eol",
      target: "Move to 22.x (supported until 2027-04)",
    });
    expect(judgeRuntime("node", node("22"), asOf)).toMatchObject({
      status: "supported",
      until: "2027-04-30",
      target: null,
    });
  });

  it("stays on the installed line for a supported runtime", () => {
    setLifecycleRows(NODE_ROWS);
    expect(judgeRuntime("node", node("22.11.0"), asOf)).toMatchObject({
      status: "minor",
      until: "2027-04-30",
      target: "Latest in your line: 22.23.4 (line supported until 2027-04)",
    });
    expect(judgeRuntime("node", node("22.23.4"), asOf)).toMatchObject({
      status: "supported",
      target: null,
    });
    // A floating tag picks up the latest on rebuild: supported, the latest named.
    expect(judgeRuntime("node", node("22-alpine", "22", "Dockerfile"), asOf)).toMatchObject({
      status: "supported",
      target: "Latest in your line: 22.23.4",
    });
  });

  it("does not judge ranges, build variables, or lines the table does not know", () => {
    expect(
      judgeRuntime("node", node(">=18", "18", "package.json engines.node"), asOf)
    ).toMatchObject({ status: "unknown", target: null });
    expect(
      judgeRuntime("php", { ...node("${PHP_VERSION}", null, "Dockerfile"), unresolved: true }, asOf)
    ).toMatchObject({ status: "unknown", note: "Version comes from a build variable" });
    expect(judgeRuntime("node", node("40"), asOf)).toMatchObject({ status: "unknown" });
    expect(judgeRuntime("zig", node("0.13.0"), asOf)).toMatchObject({ status: "unknown" });
  });
});

describe("repo urgency and order", () => {
  const card = (repo: string, statuses: StackRepo["entries"][number]["status"][], behind = 0) => {
    const entries = statuses.map((status, i) => ({
      key: `${repo}:${i}`,
      kind: "package" as const,
      label: `p${i}`,
      version: "1.0.0",
      source: null,
      status,
      until: null,
      behind: status === "major" ? behind : 0,
      target: null,
      note: null,
    }));
    return {
      key: repo,
      repo,
      entries,
      urgency: repoUrgency(entries),
      eolCount: statuses.filter((s) => s === "eol").length,
      majorsBehind: entries.reduce((n, e) => n + e.behind, 0),
      eol: statuses.includes("eol"),
      drift: repoUrgency(entries) > 0,
    };
  };

  it("ranks end of life over majors behind over minor behind over current", () => {
    expect(repoUrgency([{ status: "current" }, { status: "unknown" }])).toBe(0);
    expect(repoUrgency([{ status: "supported" }, { status: "minor" }])).toBe(1);
    expect(repoUrgency([{ status: "minor" }, { status: "major" }])).toBe(2);
    expect(repoUrgency([{ status: "major" }, { status: "eol" }])).toBe(3);
  });

  it("sorts most urgent first, then by end-of-life count, majors behind and name", () => {
    const sorted = [
      card("current", ["current"]),
      card("minor", ["minor"]),
      card("major-1", ["major"], 1),
      card("eol", ["eol"]),
      card("major-3", ["major"], 3),
      card("eol-2", ["eol", "eol"]),
      card("b-same", ["current"]),
    ].sort(compareStackRepos);
    expect(sorted.map((c) => c.repo)).toEqual([
      "eol-2",
      "eol",
      "major-3",
      "major-1",
      "minor",
      "b-same",
      "current",
    ]);
  });
});

describe("computeDrift", () => {
  const result = computeDrift({
    asOf,
    repos: repos("briff", "orchid-hotel", "yard"),
    runtimes: [
      {
        repo: "briff",
        name: "node",
        version: "22-alpine",
        normalized: "22",
        source: "Dockerfile",
        image: "node",
      },
      {
        repo: "briff",
        name: "node",
        version: ">=22.12",
        normalized: "22.12",
        source: "package.json engines.node",
        image: null,
      },
      {
        repo: "orchid-hotel",
        name: "node",
        version: "18",
        normalized: "18",
        source: ".nvmrc",
        image: null,
      },
      {
        repo: "briff",
        name: "postgres",
        version: "16-alpine",
        normalized: "16",
        source: "docker-compose.yml",
        image: "postgres",
      },
      {
        repo: "yard",
        name: "image",
        version: "ghcr.io/x/y:1",
        normalized: null,
        source: "Dockerfile",
        image: null,
      },
    ],
    dependencies: [
      { repo: "briff", packageName: "next", installedVersion: "16.2.0", latestVersion: "16.2.0" },
      {
        repo: "orchid-hotel",
        packageName: "next",
        installedVersion: "14.2.3",
        latestVersion: "16.2.0",
      },
      { repo: "yard", packageName: "next", installedVersion: "15.5.0", latestVersion: "16.2.0" },
      {
        repo: "orchid-hotel",
        packageName: "payload",
        installedVersion: "2.30.0",
        latestVersion: "3.91.0",
      },
      { repo: "briff", packageName: "zod", installedVersion: "4.1.0", latestVersion: null },
      {
        repo: "briff",
        packageName: "@types/react",
        installedVersion: "19.0.0",
        latestVersion: "19.0.0",
      },
      {
        repo: "yard",
        packageName: "@types/react",
        installedVersion: "19.0.0",
        latestVersion: "19.0.0",
      },
    ],
  });
  const card = (repo: string) => result.find((r) => r.repo === repo);

  it("lists only what a repo uses: runtimes first (most used), then key packages; no image or @types", () => {
    expect(card("briff")?.entries.map((e) => e.key)).toEqual([
      "runtime:node",
      "runtime:postgres",
      "package:next",
      "package:zod",
    ]);
    expect(card("yard")?.entries.map((e) => e.key)).toEqual(["package:next"]);
    expect(card("briff")?.entries[0].label).toBe("Node.js");
  });

  it("flags end-of-life lines, names the migration and sums majors behind", () => {
    const orchidHotel = card("orchid-hotel");
    expect(orchidHotel?.entries[0]).toMatchObject({
      version: "18",
      status: "eol",
      until: "2025-04-30",
      target: "Move to 22.x (supported until 2027-04)",
    });
    expect(orchidHotel).toMatchObject({
      eol: true,
      eolCount: 1,
      majorsBehind: 3,
      drift: true,
      urgency: 3,
    });
  });

  it("prefers the image row and names the other files", () => {
    expect(card("briff")?.entries[0]).toMatchObject({
      version: "22",
      status: "supported",
      until: "2027-04-30",
      source: "Dockerfile +1",
    });
    expect(card("briff")).toMatchObject({ eol: false, majorsBehind: 0, drift: false, urgency: 0 });
  });

  it("orders repos: end of life, then majors behind, then the rest", () => {
    expect(result.map((r) => r.repo)).toEqual(["orchid-hotel", "yard", "briff"]);
  });

  it("keys repos by the given key, so two repos with one name stay apart", () => {
    const twins = computeDrift({
      asOf,
      repos: [
        { key: "id-local", name: "acme/web" },
        { key: "id-github", name: "acme/web" },
      ],
      runtimes: [
        {
          repo: "id-local",
          name: "node",
          version: "18",
          normalized: "18",
          source: ".nvmrc",
          image: null,
        },
      ],
      dependencies: [],
    });
    expect(twins.map((r) => [r.key, r.entries.length])).toEqual([
      ["id-local", 1],
      ["id-github", 0],
    ]);
  });

  it("caps the key packages", () => {
    const capped = computeDrift({
      asOf,
      repos: repos("a"),
      runtimes: [],
      dependencies: ["p1", "p2", "p3"].map((p) => ({
        repo: "a",
        packageName: p,
        installedVersion: "1.0.0",
        latestVersion: "1.0.0",
      })),
      packageColumns: 2,
    });
    expect(capped[0].entries.map((e) => e.label)).toEqual(["p1", "p2"]);
  });
});

describe("computeDrift with engines ranges", () => {
  const rt = (repo: string, version: string, normalized: string, source: string) => ({
    repo,
    name: "node",
    version,
    normalized,
    source,
    image: source === "Dockerfile" ? "node" : null,
  });
  const entry = (rows: ReturnType<typeof rt>[], repo: string) =>
    computeDrift({ asOf, repos: repos(repo), runtimes: rows, dependencies: [] })[0].entries[0];

  it("judges the Dockerfile, not a workspace package's engines range (the Briff repo)", () => {
    expect(
      entry(
        [
          rt("briff", "22-alpine", "22", "Dockerfile"),
          rt("briff", ">=22.12", "22.12", "package.json engines.node"),
          rt("briff", ">=20", "20", "packages/scan/package.json engines.node"),
        ],
        "briff"
      )
    ).toMatchObject({ version: "22", status: "supported", source: "Dockerfile +2" });
  });

  it("shows a range alone without calling it end-of-life", () => {
    expect(entry([rt("lib", ">=20", "20", "package.json engines.node")], "lib")).toMatchObject({
      version: "20+",
      status: "unknown",
    });
    expect(entry([rt("old", "^18", "18", "package.json engines.node")], "old")).toMatchObject({
      version: "18.x",
      status: "unknown",
    });
  });

  it("prefers the root's range over a workspace package's", () => {
    expect(
      entry(
        [
          rt("mono", ">=22.12", "22.12", "package.json engines.node"),
          rt("mono", ">=18", "18", "packages/a/package.json engines.node"),
        ],
        "mono"
      )
    ).toMatchObject({ version: "22.12+", source: "package.json engines.node +1" });
  });

  it("still flags a concrete end-of-life version next to a range", () => {
    expect(
      entry(
        [
          rt("legacy", "18", "18", ".nvmrc"),
          rt("legacy", ">=18", "18", "package.json engines.node"),
        ],
        "legacy"
      )
    ).toMatchObject({ version: "18", status: "eol" });
  });
});

describe("computeDrift with several ecosystems", () => {
  const dep = (repo: string, ecosystem: string, packageName: string, installedVersion: string) => ({
    repo,
    ecosystem,
    packageName,
    installedVersion,
    latestVersion: null,
  });

  it("keeps one entry per (ecosystem, package) and tags them only when ecosystems mix", () => {
    const mixed = computeDrift({
      repos: repos("acme/shop", "acme/web"),
      runtimes: [],
      dependencies: [
        dep("acme/shop", "Packagist", "acme/log", "3.0.2"),
        dep("acme/web", "npm", "acme/log", "1.0.0"),
      ],
      asOf,
    });
    expect(mixed.flatMap((r) => r.entries.map((e) => [r.repo, e.label, e.ecosystem]))).toEqual([
      ["acme/shop", "acme/log", "Composer"],
      ["acme/web", "acme/log", "npm"],
    ]);

    const single = computeDrift({
      repos: repos("acme/shop"),
      runtimes: [],
      dependencies: [dep("acme/shop", "Packagist", "acme/log", "3.0.2")],
      asOf,
    });
    expect(single[0].entries[0].ecosystem).toBeUndefined();
  });
});

describe("computeDrift with an unresolved requirement", () => {
  it("shows the requirement as written and never judges it against the latest version", () => {
    const [repo] = computeDrift({
      repos: repos("acme/jobs"),
      runtimes: [],
      dependencies: [
        {
          repo: "acme/jobs",
          ecosystem: "PyPI",
          packageName: "acme-http",
          installedVersion: ">=2.0,<3",
          latestVersion: "4.0.0",
          unresolved: true,
        },
      ],
      asOf,
    });
    expect(repo.entries[0]).toMatchObject({
      version: ">=2.0,<3",
      status: "unknown",
      behind: 0,
      target: null,
    });
    expect(repo.majorsBehind).toBe(0);
  });
});

it("labels an Actions-only stack", () => {
  const [repo] = computeDrift({
    asOf,
    repos: repos("acme/web"),
    runtimes: [],
    dependencies: [
      {
        repo: "acme/web",
        ecosystem: "GitHub Actions",
        packageName: "actions/checkout",
        installedVersion: "v4",
        latestVersion: "5.0.0",
      },
    ],
  });
  expect(repo.entries[0]).toMatchObject({ ecosystem: "Actions" });
  expect(repo.majorsBehind).toBe(0);
});
