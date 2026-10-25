import { describe, expect, it } from "vitest";

import { bearerToken, safeEqual } from "./crypto";

describe("safeEqual", () => {
  it("compares by value, including different lengths", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("bearerToken", () => {
  it("parses bearer headers and rejects others", () => {
    expect(bearerToken("Bearer xyz")).toBe("xyz");
    expect(bearerToken("bearer   xyz ")).toBe("xyz");
    expect(bearerToken("Basic xyz")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
});
