import { describe, expect, it } from "vitest";

import { endOfLifeDate, isEndOfLife, lineLifecycle } from "./runtime-eol";

const OCT_2026 = new Date("2026-10-23T00:00:00Z");

describe("isEndOfLife", () => {
  it("knows node 18 and 20 are past end of life in October 2026, 22 is not", () => {
    expect(isEndOfLife("node", "18", OCT_2026)).toBe(true);
    expect(isEndOfLife("node", "20", OCT_2026)).toBe(true);
    expect(isEndOfLife("node", "22", OCT_2026)).toBe(false);
    expect(isEndOfLife("node", "20", new Date("2026-04-30T12:00:00Z"))).toBe(false);
  });

  it("treats lines older than the table as end of life and newer ones as supported", () => {
    expect(isEndOfLife("node", "12", OCT_2026)).toBe(true);
    expect(isEndOfLife("node", "28", OCT_2026)).toBe(false);
    expect(lineLifecycle("node", "27", OCT_2026)).toBe("unknown");
    expect(lineLifecycle("php", "8.6", OCT_2026)).toBe("unknown");
  });

  it("treats a line missing below the newest known one as end of life", () => {
    expect(lineLifecycle("node", "17", OCT_2026)).toBe("eol");
    expect(lineLifecycle("node", "13", OCT_2026)).toBe("eol");
    expect(lineLifecycle("php", "7.3", OCT_2026)).toBe("eol");
    expect(lineLifecycle("php", "8.0", OCT_2026)).toBe("eol");
    expect(lineLifecycle("node", "22", OCT_2026)).toBe("supported");
    expect(lineLifecycle("dotnet", "6.0", OCT_2026)).toBe("supported");
    expect(isEndOfLife("php", "8.1", OCT_2026)).toBe(true);
    expect(isEndOfLife("php", "8.3", OCT_2026)).toBe(false);
    expect(isEndOfLife("python", "3.9", OCT_2026)).toBe(true);
    expect(isEndOfLife("postgres", "13", OCT_2026)).toBe(true);
  });

  it("says nothing about runtimes it does not cover", () => {
    expect(isEndOfLife("dotnet", "6.0", OCT_2026)).toBe(false);
    expect(endOfLifeDate("node", "18")).toBe("2025-04-30");
    expect(endOfLifeDate("java", "17")).toBeNull();
  });
});
