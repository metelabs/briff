import { describe, expect, it } from "vitest";

import { signupFooter } from "./signup-state";

describe("signupFooter", () => {
  it("says sign-ups are closed only on the sign-in form of a closed instance", () => {
    expect(signupFooter("sign-in", false)).toBe("closed");
    expect(signupFooter("sign-in", true)).toBe("toggle");
    expect(signupFooter("bootstrap", false)).toBeNull();
    expect(signupFooter("bootstrap", true)).toBeNull();
  });
});
