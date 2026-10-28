import { describe, expect, it } from "vitest";
import { signupAllowed } from "./signup-limit";

describe("signup window", () => {
  it("shares a missing-IP bucket and expires windows after one hour", () => {
    for (let i = 0; i < 5; i++) expect(signupAllowed(null, 0)).toBe(true);
    expect(signupAllowed(undefined, 1)).toBe(false);
    expect(signupAllowed("192.0.2.90", 1)).toBe(true);
    expect(signupAllowed(null, 3_600_000)).toBe(true);
  });
});
