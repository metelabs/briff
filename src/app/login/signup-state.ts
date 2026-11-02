export type AuthMode = "sign-in" | "bootstrap";

/** The two auth routes: /login signs in, /signup creates an account. */
export type AuthRoute = "login" | "signup";

export type AuthView = { kind: "form"; mode: AuthMode; signup: boolean } | { kind: "closed" };

/**
 * What /login or /signup renders. The first account is always allowed, so an empty instance
 * shows "Set up Briff" on either route; /signup on a closed instance shows the closed notice.
 */
export function authView(route: AuthRoute, hasUsers: boolean, allowSignup: boolean): AuthView {
  if (!hasUsers) return { kind: "form", mode: "bootstrap", signup: true };
  if (route === "login") return { kind: "form", mode: "sign-in", signup: false };
  return allowSignup ? { kind: "form", mode: "sign-in", signup: true } : { kind: "closed" };
}

/**
 * What the auth form shows under it: the link to the other route when sign-ups are open, the
 * "closed" notice when they are not, nothing while bootstrapping (the first account is always
 * allowed and the form is already the sign-up form).
 */
export function signupFooter(mode: AuthMode, allowSignup: boolean): "toggle" | "closed" | null {
  if (mode === "bootstrap") return null;
  return allowSignup ? "toggle" : "closed";
}
