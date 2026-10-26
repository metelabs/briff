import { describe, expect, it } from "vitest";

import { computeDrift, packageCell } from "./stack-drift";

const asOf = new Date("2026-10-23T00:00:00Z");

describe("packageCell", () => {
  it("is current at or past the latest version", () => {
    expect(packageCell(["16.2.0"], "16.2.0")).toMatchObject({ status: "ok", version: "16.2.0" });
  });

  it("is minor behind on the same release line", () => {
    expect(packageCell(["16.1.4"], "16.2.0")).toMatchObject({ status: "minor", behind: 0 });
  });

  it("counts majors behind, and minor lines below 1.0", () => {
    expect(packageCell(["14.2.35"], "16.2.0")).toMatchObject({ status: "major", behind: 2 });
    expect(packageCell(["0.4.0"], "0.5.1")).toMatchObject({ status: "major", behind: 1 });
  });

  it("keeps prerelease ordering: an rc is behind its release", () => {
    expect(packageCell(["19.0.0-rc.1"], "19.0.0")).toMatchObject({ status: "minor" });
    expect(packageCell(["19.0.0"], "19.0.0")).toMatchObject({ status: "ok" });
  });

  it("judges the lowest installed version", () => {
    expect(packageCell(["19.2.0", "18.3.1"], "19.2.0")).toMatchObject({
      version: "18.3.1",
      status: "major",
      behind: 1,
    });
  });

  it("shows the installed version alone without a latest version", () => {
    expect(packageCell(["5.9.3"], null)).toMatchObject({ status: "plain", version: "5.9.3" });
    expect(packageCell([], "1.0.0")).toMatchObject({ status: "none", version: null });
  });
});

describe("computeDrift", () => {
  const result = computeDrift({
    asOf,
    repos: ["briff", "orchid-hotel", "yard"],
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

  it("puts runtimes first (most used), then the most used packages; no image or @types column", () => {
    expect(result.columns.map((c) => c.key)).toEqual([
      "runtime:node",
      "runtime:postgres",
      "package:next",
      "package:payload",
      "package:zod",
    ]);
    expect(result.columns[0].label).toBe("Node.js");
    expect(result.columns[4].latest).toBeNull();
  });

  it("flags end-of-life lines and sums majors behind", () => {
    const orchidHotel = result.rows.find((r) => r.repo === "orchid-hotel");
    expect(orchidHotel?.cells["runtime:node"]).toMatchObject({ version: "18", status: "eol" });
    expect(orchidHotel).toMatchObject({ eol: true, majorsBehind: 3, drift: true });
  });

  it("prefers the image row and names the other files", () => {
    const briff = result.rows.find((r) => r.repo === "briff");
    expect(briff?.cells["runtime:node"]).toMatchObject({
      version: "22",
      status: "plain",
      source: "Dockerfile +1",
    });
    expect(briff).toMatchObject({ eol: false, majorsBehind: 0, drift: false });
  });

  it("orders rows: end-of-life, then majors behind, then name", () => {
    expect(result.rows.map((r) => r.repo)).toEqual(["orchid-hotel", "yard", "briff"]);
    expect(result.rows[1].cells["runtime:node"].status).toBe("none");
  });

  it("caps the package columns", () => {
    const capped = computeDrift({
      asOf,
      repos: ["a"],
      runtimes: [],
      dependencies: ["p1", "p2", "p3"].map((p) => ({
        repo: "a",
        packageName: p,
        installedVersion: "1.0.0",
        latestVersion: "1.0.0",
      })),
      packageColumns: 2,
    });
    expect(capped.columns.map((c) => c.label)).toEqual(["p1", "p2"]);
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
  const cell = (rows: ReturnType<typeof rt>[], repo: string) =>
    computeDrift({ asOf, repos: [repo], runtimes: rows, dependencies: [] }).rows[0].cells[
      "runtime:node"
    ];

  it("judges the Dockerfile, not a workspace package's engines range (the Briff repo)", () => {
    expect(
      cell(
        [
          rt("briff", "22-alpine", "22", "Dockerfile"),
          rt("briff", ">=22.12", "22.12", "package.json engines.node"),
          rt("briff", ">=20", "20", "packages/scan/package.json engines.node"),
        ],
        "briff"
      )
    ).toMatchObject({ version: "22", status: "plain", source: "Dockerfile +2" });
  });

  it("shows a range alone without calling it end-of-life", () => {
    expect(cell([rt("lib", ">=20", "20", "package.json engines.node")], "lib")).toMatchObject({
      version: "20+",
      status: "plain",
    });
    expect(cell([rt("old", "^18", "18", "package.json engines.node")], "old")).toMatchObject({
      version: "18.x",
      status: "plain",
    });
  });

  it("prefers the root's range over a workspace package's", () => {
    expect(
      cell(
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
      cell(
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

  it("keeps one column per (ecosystem, package) and tags them only when ecosystems mix", () => {
    const mixed = computeDrift({
      repos: ["acme/shop", "acme/web"],
      runtimes: [],
      dependencies: [
        dep("acme/shop", "Packagist", "acme/log", "3.0.2"),
        dep("acme/web", "npm", "acme/log", "1.0.0"),
      ],
      asOf,
    });
    expect(mixed.columns.map((c) => [c.label, c.ecosystem])).toEqual([
      ["acme/log", "Composer"],
      ["acme/log", "npm"],
    ]);
    const web = mixed.rows.find((r) => r.repo === "acme/web");
    expect(Object.values(web?.cells ?? {}).map((c) => c.version)).toEqual([null, "1.0.0"]);

    const single = computeDrift({
      repos: ["acme/shop"],
      runtimes: [],
      dependencies: [dep("acme/shop", "Packagist", "acme/log", "3.0.2")],
      asOf,
    });
    expect(single.columns[0].ecosystem).toBeUndefined();
  });
});

describe("computeDrift with an unresolved requirement", () => {
  it("shows the requirement as written and never judges it against the latest version", () => {
    const { rows } = computeDrift({
      repos: ["acme/jobs"],
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
    expect(Object.values(rows[0].cells)[0]).toMatchObject({
      version: ">=2.0,<3",
      status: "plain",
      behind: 0,
    });
    expect(rows[0].majorsBehind).toBe(0);
  });
});

it("labels an Actions-only stack", () => {
  const result = computeDrift({
    asOf,
    repos: ["acme/web"],
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
  expect(result.columns[0]).toMatchObject({ ecosystem: "Actions" });
  expect(result.rows[0].majorsBehind).toBe(0);
});
