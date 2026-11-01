import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Native selects, checkboxes, radios and progress bars draw the browser's own chrome, which
// ignores the design tokens (DESIGN.md §8). Only the restyled primitives in src/components/ui
// may render them; everything else uses those primitives.

const SRC = path.resolve(__dirname, "..");
const ALLOWED_DIR = path.join(SRC, "components", "ui") + path.sep;

const NATIVE = [
  { pattern: /<select[\s>]/, what: "<select>" },
  { pattern: /<input[^>]*type=["{]["']?checkbox/, what: '<input type="checkbox">' },
  { pattern: /<input[^>]*type=["{]["']?radio/, what: '<input type="radio">' },
  { pattern: /<progress[\s>]/, what: "<progress>" },
];

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "generated" ? [] : tsxFiles(full);
    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

describe("no native form controls outside src/components/ui", () => {
  it("finds none", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(SRC)) {
      if (file.startsWith(ALLOWED_DIR)) continue;
      // Collapse whitespace so a multi-line JSX tag matches like a one-line one.
      const source = readFileSync(file, "utf8").replace(/\s+/g, " ");
      for (const { pattern, what } of NATIVE) {
        if (pattern.test(source)) offenders.push(`${path.relative(SRC, file)}: ${what}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
