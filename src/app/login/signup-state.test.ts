import { describe, expect, it } from "vitest";

import { initialSignup, signupFooter } from "./signup-state";

describe("signupFooter", () => {
  it("says sign-ups are closed only on the sign-in form of a closed instance", () => {
    expect(signupFooter("sign-in", false)).toBe("closed");
    expect(signupFooter("sign-in", true)).toBe("toggle");
    expect(signupFooter("bootstrap", false)).toBeNull();
    expect(signupFooter("bootstrap", true)).toBeNull();
  });
});

describe("initialSignup", () => {
  it("opens the CTA in signup mode only when registration is allowed", () => {
    expect(initialSignup("sign-in", true, true)).toBe(true);
    expect(initialSignup("sign-in", false, true)).toBe(false);
    expect(initialSignup("sign-in", true, false)).toBe(false);
    expect(initialSignup("bootstrap", false, false)).toBe(true);
  });
});
