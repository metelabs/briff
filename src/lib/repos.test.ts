import { describe, expect, it } from "vitest";

import { dependencySummary, runtimeChips, type RuntimeRow } from "./repos";

const row = (over: Partial<RuntimeRow>): RuntimeRow => ({
  name: "node",
  version: "22",
  normalized: "22",
  source: ".nvmrc",
  unresolved: false,
  ...over,
});

describe("runtimeChips", () => {
  it("shows the normalised version and the file it came from", () => {
    expect(
      runtimeChips([
        row({ name: "php", version: "8.3-fpm", normalized: "8.3", source: "Dockerfile" }),
      ])
    ).toEqual([
      {
        name: "php",
        eol: false,
        label: "php 8.3",
        sources: "Dockerfile",
        detail: "Dockerfile: 8.3-fpm",
        unresolved: false,
      },
    ]);
  });

  it("merges files that declare the same version and lists images last", () => {
    const chips = runtimeChips([
      row({
        name: "image",
        version: "ghcr.io/acme/tools:2.1",
        normalized: null,
        source: "Dockerfile",
      }),
      row({ source: "Dockerfile", version: "22-alpine" }),
      row({}),
      row({ source: "package.json engines.node", version: ">=22.12", normalized: "22.12" }),
    ]);
    expect(chips.map((c) => `${c.label} · ${c.sources}`)).toEqual([
      "node 22 · .nvmrc +1",
      "node 22.12+ · package.json engines.node",
      "image ghcr.io/acme/tools:2.1 · Dockerfile",
    ]);
  });

  it("shows a constraint in its readable form and keeps the raw text in the detail", () => {
    const chips = runtimeChips([
      row({ source: "packages/scan/package.json engines.node", version: ">=20", normalized: "20" }),
      row({ source: "package.json engines.node", version: "18 || 20", normalized: "18" }),
      row({ name: "php", source: "composer.json require.php", version: "^8.3", normalized: "8.3" }),
    ]);
    expect(chips.map((c) => [c.label, c.detail])).toEqual([
      ["node 18 or 20", "package.json engines.node: 18 || 20 (constraint)"],
      ["node 20+", "packages/scan/package.json engines.node: >=20 (constraint)"],
      ["php 8.3+", "composer.json require.php: ^8.3 (constraint)"],
    ]);
  });

  it("never calls a constraint end-of-life, only a concrete row", () => {
    const asOf = new Date("2026-10-23T00:00:00Z");
    const chips = runtimeChips(
      [
        row({ source: "Dockerfile", version: "22-alpine" }),
        row({
          source: "packages/scan/package.json engines.node",
          version: ">=20",
          normalized: "20",
        }),
        row({ source: "legacy/package.json engines.node", version: "^18", normalized: "18" }),
        row({ source: "legacy/.nvmrc", version: "18", normalized: "18" }),
      ],
      asOf
    );
    expect(chips.map((c) => [c.label, c.eol])).toEqual([
      ["node 18", true],
      ["node 18.x", false],
      ["node 20+", false],
      ["node 22", false],
    ]);
  });

  it("flags an end-of-life release line", () => {
    const asOf = new Date("2026-10-23T00:00:00Z");
    const chips = runtimeChips(
      [row({ version: "18", normalized: "18" }), row({ source: "Dockerfile" })],
      asOf
    );
    expect(chips.map((c) => [c.label, c.eol])).toEqual([
      ["node 18", true],
      ["node 22", false],
    ]);
  });

  it("keeps the raw text of an unresolved version", () => {
    const [chip] = runtimeChips([
      row({ name: "php", version: "${PHP_VERSION}-cli", normalized: null, unresolved: true }),
    ]);
    expect(chip).toMatchObject({ label: "php ${PHP_VERSION}-cli", unresolved: true });
  });

  it("shortens a pinned digest in the label and keeps it whole in the detail", () => {
    const ref = `golang@sha256:${"0123456789abcdef".repeat(4)}`;
    const [chip] = runtimeChips([
      row({ name: "go", version: ref, normalized: null, unresolved: true, source: "Dockerfile" }),
    ]);
    expect(chip.label).toBe("go golang@sha256:0123456789ab…");
    expect(chip.detail).toBe(`Dockerfile: ${ref}`);
  });
});

describe("dependencySummary", () => {
  it("reads as before for an npm-only repo and names ecosystems otherwise", () => {
    expect(dependencySummary([{ ecosystem: "npm", direct: 12, total: 340 }])).toEqual([
      "12 direct · 340 total",
    ]);
    expect(dependencySummary([])).toEqual(["0 direct · 0 total"]);
    expect(
      dependencySummary([
        { ecosystem: "Packagist", direct: 8, total: 61 },
        { ecosystem: "npm", direct: 12, total: 340 },
      ])
    ).toEqual(["npm 12 direct · 340 total", "Composer 8 direct · 61 total"]);
    expect(
      dependencySummary([
        { ecosystem: "npm", direct: 0, total: 0 },
        { ecosystem: "Packagist", direct: 8, total: 61 },
      ])
    ).toEqual(["Composer 8 direct · 61 total"]);
  });
});
