import { describe, expect, it } from "vitest";

import { isScannedFileName, SCANNED_FILE_NAMES, SCANNED_NAME_PATTERNS } from "./files";

describe("the scanned file list shown to people", () => {
  it("names only files the scanner reads", () => {
    for (const name of SCANNED_FILE_NAMES) expect(isScannedFileName(name), name).toBe(true);
    for (const { example } of SCANNED_NAME_PATTERNS) {
      expect(isScannedFileName(example), example).toBe(true);
    }
  });

  it("lists each name once", () => {
    const all = [...SCANNED_FILE_NAMES, ...SCANNED_NAME_PATTERNS.map((p) => p.pattern)];
    expect(new Set(all).size).toBe(all.length);
  });

  it("keeps the documented exclusions", () => {
    expect(isScannedFileName("Dockerfile.md")).toBe(false);
    expect(isScannedFileName("README.md")).toBe(false);
    expect(isScannedFileName(".env")).toBe(false);
  });
});
