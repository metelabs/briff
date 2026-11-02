import { describe, expect, it } from "vitest";

import { authView, signupFooter } from "./signup-state";

describe("signupFooter", () => {
  it("says sign-ups are closed only on the sign-in form of a closed instance", () => {
    expect(signupFooter("sign-in", false)).toBe("closed");
    expect(signupFooter("sign-in", true)).toBe("toggle");
    expect(signupFooter("bootstrap", false)).toBeNull();
    expect(signupFooter("bootstrap", true)).toBeNull();
  });
});

describe("authView", () => {
  it("signs in on /login and signs up on /signup when sign-ups are open", () => {
    expect(authView("login", true, true)).toEqual({ kind: "form", mode: "sign-in", signup: false });
    expect(authView("signup", true, true)).toEqual({ kind: "form", mode: "sign-in", signup: true });
  });

  it("closes /signup but keeps /login on a closed instance", () => {
    expect(authView("signup", true, false)).toEqual({ kind: "closed" });
    expect(authView("login", true, false)).toEqual({
      kind: "form",
      mode: "sign-in",
      signup: false,
    });
  });

  it("sets up the first account on either route, whatever ALLOW_SIGNUP says", () => {
    for (const route of ["login", "signup"] as const) {
      expect(authView(route, false, false)).toEqual({
        kind: "form",
        mode: "bootstrap",
        signup: true,
      });
    }
  });
});
