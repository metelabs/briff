import { describe, expect, it } from "vitest";

import {
  affectedRuntimeRepos,
  describeRow,
  evidenceRows,
  formatUtc,
  imageFor,
  isImageRow,
  runtimeAction,
  runtimeRepoActions,
  runtimeRepoGaps,
  type RuntimeRow,
} from "./runtime-fixes";

const PHP2SHELL = { fixedVersions: ["8.5.12", "8.4.27", "8.3.36", "8.2.35"] };

function row(repo: string, version: string, normalized: string | null, source: string): RuntimeRow {
  return { repo, name: "php", version, normalized, source, unresolved: false };
}

describe("runtimeAction", () => {
  it("says a floating image tag only needs a rebuild", () => {
    expect(
      runtimeAction("php", PHP2SHELL, [row("garden.example", "8.3-fpm", "8.3", "Dockerfile")])
    ).toBe(
      "garden.example: rebuild to pick up PHP 8.3.36; the php:8.3-fpm tag already points to it"
    );
  });

  it("names the tag to move to when the image is pinned", () => {
    expect(
      runtimeAction("php", PHP2SHELL, [
        row("orchid-hotel", "8.3.20-fpm-alpine", "8.3.20", "docker/Dockerfile"),
      ])
    ).toBe("orchid-hotel: move docker/Dockerfile to php:8.3.36-fpm-alpine");
  });

  it("names the version to set in a version file, and the floor for a constraint", () => {
    expect(runtimeAction("php", PHP2SHELL, [row("a", "8.4.10", "8.4.10", ".tool-versions")])).toBe(
      "a: set php 8.4.27 in .tool-versions"
    );
    expect(
      runtimeAction("php", PHP2SHELL, [row("b", "^8.2", "8.2", "composer.json require.php")])
    ).toBe("b: run php 8.2.35 or later (composer.json require.php allows ^8.2)");
  });

  it("prefers the Dockerfile over composer.json for the same repo", () => {
    const rows = [
      row("garden.example", "^8.1", "8.1", "composer.json require.php"),
      row("garden.example", "8.3-fpm", "8.3", "Dockerfile"),
    ];
    expect(affectedRuntimeRepos("php", PHP2SHELL, rows).map((a) => a.row.source)).toEqual([
      "Dockerfile",
    ]);
  });

  it("never suggests a major upgrade for an unsupported line that is still supported", () => {
    const beforeEol = new Date("2025-06-01T00:00:00Z");
    expect(
      runtimeAction("php", PHP2SHELL, [row("old", "8.1-apache", "8.1", "Dockerfile")], beforeEol)
    ).toBe("old: PHP 8.1 gets no fix; move to 8.2.35 (same major)");
  });

  it("says an end-of-life line will not get the fix and names the lowest newer fix", () => {
    const asOf = new Date("2026-10-23T00:00:00Z");
    expect(
      runtimeAction("php", PHP2SHELL, [row("older", "7.4", "7.4", ".php-version")], asOf)
    ).toBe("older: php 7.4 is end-of-life and will not get this fix; move to 8.2.35 or later");
  });

  it("leaves out repos already on the fix and returns null when none is left", () => {
    expect(
      runtimeAction("php", PHP2SHELL, [row("done", "8.3.36", "8.3.36", ".tool-versions")])
    ).toBeNull();
  });

  it("says why a version is unknown and asks it to be checked", () => {
    const unresolved = {
      ...row("office-ledger", "${PHP_VERSION}-fpm", null, "Dockerfile"),
      unresolved: true,
    };
    expect(runtimeAction("php", PHP2SHELL, [unresolved])).toBe(
      "office-ledger: php version unknown (the Dockerfile tag uses a build argument: ${PHP_VERSION}-fpm); check which version runs; fixed in 8.5.12, 8.4.27, 8.3.36, 8.2.35"
    );
    expect(describeRow(unresolved)).toBe("php, version unknown (Dockerfile: ${PHP_VERSION}-fpm)");
    expect(
      runtimeAction("php", PHP2SHELL, [
        { ...row("x", "php@sha256:abc", null, "Dockerfile"), unresolved: true },
      ])
    ).toBe(
      "x: php version unknown (Dockerfile pins the image by digest only); check which version runs; fixed in 8.5.12, 8.4.27, 8.3.36, 8.2.35"
    );
    // Resolved but without a version (`latest`): the raw value is enough.
    expect(runtimeAction("php", PHP2SHELL, [row("y", "latest", null, "Dockerfile")])).toBe(
      "y: check which PHP version runs (Dockerfile: latest); fixed in 8.5.12, 8.4.27, 8.3.36, 8.2.35"
    );
  });

  it("says to update once a pre-announced release is out, else to read the advisory", () => {
    const rows = [row("garden.example", "8.3-fpm", "8.3", "Dockerfile")];
    expect(
      runtimeAction("php", { fixedVersions: [], scheduledAt: "2026-10-21T14:00:00.000Z" }, rows)
    ).toBe(
      "Update PHP in garden.example as soon as the fixed release is out (announced for 21 Oct 2026, 14:00 UTC)."
    );
    expect(runtimeAction("php", { fixedVersions: [] }, rows)).toBe(
      "Read the advisory and check garden.example; it names no fixed PHP version yet."
    );
  });

  it("shortens a long list of repos", () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row(`client-site-number-${i}`, "8.3-fpm", "8.3", "Dockerfile")
    );
    expect(runtimeAction("php", PHP2SHELL, rows)).toBe(
      "Update PHP to 8.3.36 in 12 repos (see the advisory)."
    );
  });
});

describe(".NET images from mcr.microsoft.com", () => {
  const dotnet = (version: string, normalized: string): RuntimeRow => ({
    repo: "budget",
    name: "dotnet",
    version,
    normalized,
    source: "Dockerfile",
    unresolved: false,
    image: "mcr.microsoft.com/dotnet/aspnet",
  });
  const fixed = { fixedVersions: ["8.0.22", "9.0.11"] };

  it("names the scanned repository for a floating tag", () => {
    expect(runtimeAction("dotnet", fixed, [dotnet("8.0", "8.0")])).toBe(
      "budget: rebuild to pick up .NET 8.0.22; the mcr.microsoft.com/dotnet/aspnet:8.0 tag already points to it"
    );
  });

  it("names the tag to move to for a pinned tag", () => {
    expect(runtimeAction("dotnet", fixed, [dotnet("8.0.21-alpine", "8.0.21")])).toBe(
      "budget: move Dockerfile to mcr.microsoft.com/dotnet/aspnet:8.0.22-alpine"
    );
  });
});

describe("helpers", () => {
  it("knows image rows, image names and how a row reads", () => {
    expect(isImageRow({ source: "Dockerfile" })).toBe(true);
    expect(isImageRow({ source: "deploy/docker-compose.yml" })).toBe(true);
    expect(isImageRow({ source: "composer.json require.php" })).toBe(false);
    expect(imageFor("go")).toBe("golang");
    expect(imageFor("dotnet")).toBeNull();
    expect(describeRow(row("garden.example", "8.3-fpm", "8.3", "Dockerfile"))).toBe(
      "php 8.3 (Dockerfile)"
    );
    expect(describeRow(row("garden.example", "^8.3", "8.3", "composer.json require.php"))).toBe(
      "php 8.3+ (composer.json require.php)"
    );
    expect(formatUtc("2026-10-21T14:00:00.000Z")).toBe("21 Oct 2026, 14:00 UTC");
    expect(formatUtc("2026-10-21")).toBe("21 Oct 2026");
  });
});

describe("Node.js October 2026 security release", () => {
  const asOf = new Date("2026-10-23T00:00:00Z");
  const node = (repo: string, version: string, normalized: string, source: string): RuntimeRow => ({
    repo,
    name: "node",
    version,
    normalized,
    source,
    unresolved: false,
    image: source.includes("Dockerfile") ? "node" : null,
  });
  const lines = { affectedLines: ["26", "24", "22"] };
  const post = { ...lines, fixedVersions: ["22.23.4", "24.22.1", "26.12.1"] };
  const pre = { ...lines, fixedVersions: [], scheduledAt: "2026-10-21" };
  const rows = [
    node("grove", "22-alpine", "22", "Dockerfile"),
    node("forms-web", "22.17.0-alpine", "22.17.0", "Dockerfile"),
    node("briff", ">=20.9.0", "20.9.0", "package.json engines.node"),
    node("bakery.example", "18-alpine", "18", "Dockerfile"),
    node("pantheon", "24.16.0", "24.16.0", ".nvmrc"),
  ];

  it("derives one action per repo once the fixed versions are out", () => {
    expect(runtimeRepoActions("node", post, rows, asOf)).toEqual([
      "bakery.example: node 18 is end-of-life and will not get this fix; move to 22.23.4 or later",
      "briff: run node 22.23.4 or later (package.json engines.node allows >=20.9.0)",
      "forms-web: move Dockerfile to node:22.23.4-alpine",
      "grove: rebuild to pick up Node.js 22.23.4; the node:22-alpine tag already points to it",
      "pantheon: set node 24.22.1 in .nvmrc",
    ]);
  });

  it("before the release, waits for the fix on listed lines and still flags the EOL line", () => {
    expect(runtimeRepoActions("node", pre, rows, asOf)).toEqual([
      "Update Node.js in briff, forms-web, grove, pantheon as soon as the fixed release is out (announced for 21 Oct 2026).",
      "bakery.example: node 18 is end-of-life and will not get this fix; move to 22 or later",
    ]);
  });

  it("leaves out a supported line the post does not list, and a bound already past the fix", () => {
    const only2426 = { affectedLines: ["26", "24"], fixedVersions: ["24.22.1", "26.12.1"] };
    expect(
      runtimeRepoActions(
        "node",
        only2426,
        [
          node("lts", "22-alpine", "22", "Dockerfile"),
          node("done", ">=24.22.1", "24.22.1", "package.json engines.node"),
        ],
        asOf
      )
    ).toEqual([]);
  });

  it("flags a line missing from the EOL table and still emails a line newer than it", () => {
    expect(
      runtimeRepoActions(
        "node",
        post,
        [
          node("old", "17-alpine", "17", "Dockerfile"),
          node("next", "27-alpine", "27", "Dockerfile"),
        ],
        asOf
      )
    ).toEqual([
      "next: check which Node.js version runs (Dockerfile: 27-alpine); fixed in 22.23.4, 24.22.1, 26.12.1",
      "old: node 17 is end-of-life and will not get this fix; move to 22.23.4 or later",
    ]);
  });

  it("judges a repo by its Dockerfile, not a workspace package's engines range", () => {
    const briff = [
      node("briff", "22-alpine", "22", "Dockerfile"),
      node("briff", ">=22.12", "22.12", "package.json engines.node"),
      node("briff", ">=20", "20", "packages/scan/package.json engines.node"),
    ];
    expect(evidenceRows(briff).map((r) => r.source)).toEqual(["Dockerfile"]);
    expect(runtimeRepoActions("node", post, briff, asOf)).toEqual([
      "briff: rebuild to pick up Node.js 22.23.4; the node:22-alpine tag already points to it",
    ]);
    expect(runtimeRepoActions("node", pre, briff, asOf)).toEqual([
      "Update Node.js in briff as soon as the fixed release is out (announced for 21 Oct 2026).",
    ]);
  });

  it("never gives a range alone the end-of-life sentence", () => {
    const ranged = [node("lib", "^20", "20", "package.json engines.node")];
    expect(affectedRuntimeRepos("node", post, ranged, asOf)[0].status).toEqual({
      kind: "unknown",
    });
    expect(runtimeRepoActions("node", post, ranged, asOf)).toEqual([
      "lib: check which Node.js version runs (package.json engines.node: ^20); fixed in 22.23.4, 24.22.1, 26.12.1",
    ]);
    expect(runtimeRepoActions("node", pre, ranged, asOf).join(" ")).not.toContain("end-of-life");
  });

  it("uses the root's range over a workspace package's when there is no concrete row", () => {
    const mono = [
      node("mono", ">=22.12", "22.12", "package.json engines.node"),
      node("mono", "^18", "18", "packages/legacy/package.json engines.node"),
    ];
    expect(evidenceRows(mono).map((r) => r.source)).toEqual(["package.json engines.node"]);
    expect(runtimeRepoActions("node", post, mono, asOf)).toEqual([
      "mono: run node 22.23.4 or later (package.json engines.node allows >=22.12)",
    ]);
  });

  it("words the EOL sentence as a migration, never as a command or an image reference", () => {
    const [eol] = runtimeRepoActions(
      "node",
      post,
      [node("bakery.example", "18-alpine", "18", "Dockerfile")],
      asOf
    );
    expect(eol).toContain("is end-of-life and will not get this fix");
    expect(eol).not.toMatch(/npm i|FROM |node:\d|set node|rebuild/);
  });
});

describe("runtimeRepoGaps", () => {
  it("names the matched repos that get no action, and why", () => {
    const rows = [
      row("garden.example", "8.3-fpm", "8.3", "Dockerfile"),
      row("done", "8.3.36", "8.3.36", ".tool-versions"),
    ];
    expect(runtimeRepoGaps("php", PHP2SHELL, ["garden.example", "done", "gone"], rows)).toEqual({
      unaffected: ["done (8.3.36 in .tool-versions)"],
      noVersion: ["gone"],
    });
  });
});
