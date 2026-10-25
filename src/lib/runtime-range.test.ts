import { describe, expect, it } from "vitest";

import { formatVersionRange, isVersionRange, runtimeVersionLabel } from "./runtime-range";

describe("formatVersionRange", () => {
  it.each([
    [">=20", "20+"],
    [">= 20.0.0", "20+"],
    [">=22.12", "22.12+"],
    [">=20.9.0", "20.9+"],
    ["^22.1.0", "22.x"],
    ["^22", "22.x"],
    ["^0.5.1", "0.5.x"],
    ["~8.2.0", "8.2.x"],
    ["~22", "22.x"],
    ["22.x", "22.x"],
    ["8.2.*", "8.2.x"],
    ["18 || 20", "18 or 20"],
    ["^18 || ^20 || ^22", "18.x, 20.x or 22.x"],
    ["^8.2|^8.3", "8.x"],
    ["v20", "20"],
  ])("%s -> %s", (raw, shown) => {
    expect(formatVersionRange(raw)).toBe(shown);
  });

  it("keeps a caret's minor for runtimes released per minor", () => {
    expect(formatVersionRange("^8.3", "php")).toBe("8.3+");
    expect(formatVersionRange("^8", "php")).toBe("8.x");
    expect(formatVersionRange("^22.1.0", "node")).toBe("22.x");
    expect(formatVersionRange("^8.2 || ^8.3", "php")).toBe("8.2+ or 8.3+");
  });

  it.each([">=18 <21", "lts/*", "*", ">20", "==3.11.*", "~>3.2", "18 || lts/*", ""])(
    "does not read %j",
    (raw) => {
      expect(formatVersionRange(raw)).toBeNull();
    }
  );
});

describe("isVersionRange", () => {
  it("tells constraints from concrete versions", () => {
    expect([">=20", "^8.3", "~1.2", "18 || 20", "22.x", "3.11.*"].map(isVersionRange)).toEqual(
      Array(6).fill(true)
    );
    expect(
      ["22", "22.11.0", "22-alpine", "8.3-fpm", "lts/iron", "go1.23"].map(isVersionRange)
    ).toEqual(Array(6).fill(false));
  });
});

describe("runtimeVersionLabel", () => {
  it("formats a range and keeps concrete versions as normalised", () => {
    expect(runtimeVersionLabel({ name: "node", version: ">=20", normalized: "20" })).toBe("20+");
    expect(runtimeVersionLabel({ name: "node", version: "22-alpine", normalized: "22" })).toBe(
      "22"
    );
    expect(runtimeVersionLabel({ name: "node", version: "22.11.0", normalized: "22.11.0" })).toBe(
      "22.11.0"
    );
  });

  it("falls back to the raw text for a range it does not read", () => {
    expect(runtimeVersionLabel({ name: "node", version: ">=18 <21", normalized: "18" })).toBe(
      ">=18 <21"
    );
  });

  it("leaves an unresolved row alone", () => {
    expect(
      runtimeVersionLabel({
        name: "node",
        version: "${NODE_VERSION}",
        normalized: null,
        unresolved: true,
      })
    ).toBe("${NODE_VERSION}");
  });
});
