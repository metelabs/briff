import { describe, expect, it } from "vitest";

import { RUNTIME_IDS } from "@scan/runtimes";

import { CURATED_SOURCES, RUNTIME_SOURCES } from "./curated";

// Runtimes without any verified channel (docs/SOURCES.md, "Runtime gaps").
const NO_SOURCE = new Set(["java", "mysql"]);

describe("curated sources", () => {
  it("has unique URLs", () => {
    const urls = CURATED_SOURCES.map((s) => s.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("covers every runtime id or lists it as a gap", () => {
    const covered = new Set(RUNTIME_SOURCES.map((s) => s.runtime));
    for (const id of RUNTIME_IDS) {
      expect(covered.has(id) || NO_SOURCE.has(id), id).toBe(true);
      expect(covered.has(id) && NO_SOURCE.has(id), id).toBe(false);
    }
  });

  it("gives every runtime source a runtime and a class, and advisories the security class", () => {
    for (const s of RUNTIME_SOURCES) {
      expect(s.runtime).toBeDefined();
      expect(s.class).toBeDefined();
      expect(s.traits).toEqual([]);
      if (s.kind === "github_advisories") {
        expect(s.class).toBe("security");
        expect(s.url).toMatch(
          /^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/security-advisories$/
        );
      }
    }
  });
});
