import { describe, expect, it } from "vitest";

import { retryDelayMs } from "./backoff";

describe("retryDelayMs", () => {
  it("doubles per attempt and caps at one hour", () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(60_000);
    expect(retryDelayMs(3)).toBe(120_000);
    expect(retryDelayMs(20)).toBe(3_600_000);
  });

  it("treats non-positive attempts as the first retry", () => {
    expect(retryDelayMs(0)).toBe(30_000);
  });
});
