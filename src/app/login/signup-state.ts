export type AuthMode = "sign-in" | "bootstrap";

/**
 * What the login page shows under the form: the sign-in / create-account toggle when
 * sign-ups are open, the "closed" notice when they are not, nothing while bootstrapping
 * (the first account is always allowed and the form is already the sign-up form).
 */
export function signupFooter(mode: AuthMode, allowSignup: boolean): "toggle" | "closed" | null {
  if (mode === "bootstrap") return null;
  return allowSignup ? "toggle" : "closed";
}

/** Explicit public CTA mode still respects the instance registration setting. */
export function initialSignup(mode: AuthMode, allowSignup: boolean, requested: boolean): boolean {
  return mode === "bootstrap" || (allowSignup && requested);
}
