import * as simpleIcons from "simple-icons";
import { describe, expect, it } from "vitest";

import { RUNTIME_IDS } from "@scan/runtimes";

import {
  CATALOG,
  catalogEntry,
  catalogIconSlugs,
  cleanRuntimeVersion,
  cleanVersion,
  isExactVersion,
  isGithubRepoName,
  itemKey,
  normalizePickedName,
  PACKAGE_ENTRIES,
  RUNTIME_ENTRIES,
  searchCatalog,
  selectionKey,
  TOOL_ENTRIES,
} from "./stack-catalog";
import { missingIconSlugs, stackIcons } from "./stack-icons";

describe("stack catalog", () => {
  it("offers every runtime the scanner knows, once", () => {
    expect(RUNTIME_ENTRIES.map((e) => e.name).sort()).toEqual([...RUNTIME_IDS].sort());
  });

  it("has unique keys, and every package name is already in its stored form", () => {
    const keys = CATALOG.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of [...PACKAGE_ENTRIES, ...TOOL_ENTRIES]) {
      if (e.ecosystem === "runtime") throw new Error("runtime in the package list");
      expect(normalizePickedName(e.ecosystem, e.name), e.label).toBe(e.name);
    }
  });

  it("covers the popular set the picker promises", () => {
    const labels = new Set(PACKAGE_ENTRIES.map((e) => e.label));
    for (const label of ["React", "Next.js", "Laravel", "Django", "Spring Boot", "Sentry SDK"])
      expect(labels.has(label), label).toBe(true);
    expect(PACKAGE_ENTRIES.length).toBeGreaterThanOrEqual(45);
    expect(TOOL_ENTRIES.map((e) => e.label)).toContain("Dokploy");
  });

  it("looks entries up by key, and GitHub keys ignore case", () => {
    expect(catalogEntry("npm:next")?.label).toBe("Next.js");
    expect(catalogEntry("runtime:postgres")?.label).toBe("PostgreSQL");
    expect(catalogEntry(itemKey("GitHub", "tryghost/ghost"))?.label).toBe("Ghost");
    expect(selectionKey({ kind: "tool", name: "TRYGHOST/ghost" })).toBe(
      catalogEntry("GitHub:tryghost/ghost")?.key
    );
    expect(catalogEntry("npm:not-in-the-catalog")).toBeNull();
  });

  it("searches labels and names without punctuation or case", () => {
    expect(searchCatalog("nextjs").map((e) => e.label)).toContain("Next.js");
    expect(searchCatalog("tanstack").map((e) => e.label)).toEqual(["TanStack Query"]);
    expect(searchCatalog("postgres").map((e) => e.key)).toContain("runtime:postgres");
    expect(searchCatalog("  ")).toHaveLength(CATALOG.length);
  });

  it("checks typed names per ecosystem", () => {
    expect(normalizePickedName("npm", "@scope/pkg")).toBe("@scope/pkg");
    expect(normalizePickedName("npm", "Not Valid")).toBeNull();
    expect(normalizePickedName("Packagist", "Symfony/Console")).toBe("symfony/console");
    expect(normalizePickedName("Packagist", "console")).toBeNull();
    expect(normalizePickedName("PyPI", "Flask_SQLAlchemy")).toBe("flask-sqlalchemy");
    expect(normalizePickedName("GitHub", "TryGhost/Ghost")).toBe("TryGhost/Ghost");
    expect(normalizePickedName("GitHub", "../etc")).toBeNull();
    expect(isGithubRepoName("owner/repo.git")).toBe(false);
    expect(isGithubRepoName("owner/..")).toBe(false);
  });

  it("reads versions: empty is any, runtimes take a release line, exact versions are pins", () => {
    expect(cleanVersion("")).toBeUndefined();
    expect(cleanVersion("any")).toBeUndefined();
    expect(cleanVersion("^19.1")).toBe("^19.1");
    expect(cleanVersion("1.0; rm -rf")).toBeNull();
    expect(cleanRuntimeVersion("v22")).toBe("22");
    expect(cleanRuntimeVersion("8.3")).toBe("8.3");
    expect(cleanRuntimeVersion("22.1.0")).toBeNull();
    expect(isExactVersion("19.2.1")).toBe(true);
    expect(isExactVersion("2.0.0-rc.1")).toBe(true);
    expect(isExactVersion("^19.2.1")).toBe(false);
    expect(isExactVersion("19")).toBe(false);
  });
});

describe("stack icons", () => {
  it("every curated slug exists in simple-icons and is imported", () => {
    const known = new Set(
      Object.values(simpleIcons).flatMap((icon) =>
        typeof icon === "object" && icon !== null && "slug" in icon ? [String(icon.slug)] : []
      )
    );
    for (const slug of catalogIconSlugs()) expect(known.has(slug), slug).toBe(true);
    expect(missingIconSlugs()).toEqual([]);
    expect(Object.keys(stackIcons()).sort()).toEqual(catalogIconSlugs());
  });

  it("gives each icon a path on the 24x24 grid", () => {
    for (const [slug, icon] of Object.entries(stackIcons())) {
      expect(icon.path, slug).toMatch(/^[Mm][\d.-]/);
    }
  });
});
