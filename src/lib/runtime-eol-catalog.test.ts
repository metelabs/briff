import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import {
  fallbackLifecycleRows,
  lineLifecycle,
  endOfLifeDate,
  setLifecycleRows,
  lowestSupportedLineAbove,
} from "./runtime-eol";
import { lifecycleRows } from "./runtime-eol-catalog";

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`./__fixtures__/runtime-eol/${name}.json`, import.meta.url), "utf8")
  );
afterEach(() => setLifecycleRows([]));

describe("lifecycle catalog", () => {
  it("normalizes fetched and fallback rows to the same shape", () => {
    const fallback = fallbackLifecycleRows();
    const fetched = lifecycleRows("node", fixture("nodejs"));
    expect(Object.keys(fetched[0]).sort()).toEqual(Object.keys(fallback[0]).sort());
    const installed = fallback.find((r) => r.product === "node" && r.cycle === "22");
    expect(fetched.find((r) => r.cycle === "22")?.eol).toBe(installed?.eol);
    setLifecycleRows(fetched);
    expect(lineLifecycle("node", "18", new Date("2026-10-27"))).toBe("eol");
    expect(lowestSupportedLineAbove("node", "18", new Date("2026-10-27"))).toBe("22");
    expect(endOfLifeDate("php", "8.3")).toBe("2027-12-31");
  });
  it("keeps boolean EOL and major cycles meaningful without inventing dates", () => {
    setLifecycleRows([
      { product: "bun", cycle: "1", eol: false, latest: "1.3.0", lts: false, support: null },
    ]);
    expect(lineLifecycle("bun", "1.2", new Date())).toBe("supported");
    expect(endOfLifeDate("bun", "1.2")).toBeNull();
    setLifecycleRows([
      { product: "bun", cycle: "1", eol: true, latest: null, lts: null, support: null },
    ]);
    expect(lineLifecycle("bun", "1.2", new Date())).toBe("eol");
  });
  it("includes Debian public LTS and rejects malformed or duplicate cycles", () => {
    const debian = lifecycleRows("debian", fixture("debian"));
    expect(debian.find((r) => r.cycle === "12")?.eol).toBe("2028-06-30");
    expect(() => lifecycleRows("node", [{ cycle: "22", eol: "tomorrow" }])).toThrow();
    expect(() =>
      lifecycleRows("node", [
        { cycle: "22", eol: false },
        { cycle: "22", eol: false },
      ])
    ).toThrow();
    expect(lifecycleRows("java", fixture("eclipse-temurin")).length).toBeGreaterThan(0);
    expect(lifecycleRows("bun", fixture("bun"))[0].eol).toBe(false);
  });
});
