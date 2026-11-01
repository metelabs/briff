import { describe, expect, it } from "vitest";
import {
  authAttemptAllowed,
  authRateLimitRules,
  isLimitedAuthPath,
  signupAllowed,
} from "./signup-limit";

describe("signup window", () => {
  it("shares a missing-IP bucket and expires windows after one hour", () => {
    for (let i = 0; i < 5; i++) expect(signupAllowed(null, 0)).toBe(true);
    expect(signupAllowed(undefined, 1)).toBe(false);
    expect(signupAllowed("192.0.2.90", 1)).toBe(true);
    expect(signupAllowed(null, 3_600_000)).toBe(true);
  });
});

describe("auth attempt windows", () => {
  it("counts each endpoint separately with its own limit", () => {
    for (let i = 0; i < 3; i++) {
      expect(authAttemptAllowed("/request-password-reset", "192.0.2.91", 0)).toBe(true);
    }
    expect(authAttemptAllowed("/request-password-reset", "192.0.2.91", 1)).toBe(false);
    expect(authAttemptAllowed("/send-verification-email", "192.0.2.91", 1)).toBe(true);
    expect(authAttemptAllowed("/request-password-reset", "192.0.2.91", 3_600_000)).toBe(true);
  });

  it("mirrors the limits as Better Auth rules", () => {
    expect(authRateLimitRules()["/request-password-reset"]).toEqual({ window: 3600, max: 3 });
    expect(isLimitedAuthPath("/change-password")).toBe(true);
    expect(isLimitedAuthPath("/sign-in/email")).toBe(false);
  });
});
