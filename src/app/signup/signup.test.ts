import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ users: 1, allowSignup: true, session: false }));
vi.mock("@/lib/auth/session", () => ({
  getOrgContext: async () => (state.session ? { orgId: "org-1", userId: "u1" } : null),
}));
vi.mock("@/lib/db/client", () => ({
  getDb: () => ({ user: { count: async () => state.users } }),
}));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ ALLOW_SIGNUP: state.allowSignup }) }));
vi.mock("@/app/login/actions", () => ({
  signInAction: async () => ({ error: null }),
  signUpAction: async () => ({ error: null }),
}));
vi.mock("@/components/ui/toast", () => ({ useResultToast: () => {} }));

const { default: SignupPage } = await import("./page");
const { default: LoginPage } = await import("../login/page");

async function render(page: () => Promise<ReactElement> | ReactElement) {
  const el = await page();
  // The page returns <AuthPage>, an async server component: resolve it before rendering.
  const body = await (el.type as (p: unknown) => Promise<ReactElement>)(el.props);
  return renderToStaticMarkup(body);
}

function redirectOf(err: unknown): string | null {
  const digest = (err as { digest?: string } | null)?.digest ?? "";
  return digest.startsWith("NEXT_REDIRECT") ? digest.split(";")[2] : null;
}

const login = (mode?: string) => () =>
  LoginPage({ searchParams: Promise.resolve(mode ? { mode } : {}) });

describe("/signup and /login", () => {
  beforeEach(() => {
    Object.assign(state, { users: 1, allowSignup: true, session: false });
  });

  it("shows the sign-up form on /signup with a link to /login", async () => {
    const page = await render(SignupPage);
    expect(page).toContain("Create your account");
    expect(page).toContain('name="name"');
    expect(page).toContain('href="/login"');
    expect(page).not.toContain("Sign-ups are closed");
  });

  it("shows the sign-in form on /login with a link to /signup", async () => {
    const page = await render(login());
    expect(page).toContain("Sign in to Briff");
    expect(page).not.toContain('name="name"');
    expect(page).toContain('href="/signup"');
  });

  it("shows the closed notice on /signup when sign-ups are closed", async () => {
    state.allowSignup = false;
    const page = await render(SignupPage);
    expect(page).toContain("Sign-ups are closed");
    expect(page).not.toContain("<form");
    expect(page).toContain('href="/login"');
    const signIn = await render(login());
    expect(signIn).toContain("Sign in to Briff");
    expect(signIn).not.toContain('href="/signup"');
  });

  it("sets up the first account on either route, even when sign-ups are closed", async () => {
    state.users = 0;
    state.allowSignup = false;
    for (const page of [await render(SignupPage), await render(login())]) {
      expect(page).toContain("Set up Briff");
      expect(page).toContain('name="name"');
    }
  });

  it("links the header logo to the landing page", async () => {
    expect(await render(SignupPage)).toMatch(/<a aria-label="Briff home"[^>]*href="\/"/);
  });

  it("sends the old ?mode=sign-up link to /signup and a member home", async () => {
    await expect(login("sign-up")()).rejects.toSatisfy((e) => redirectOf(e) === "/signup");
    state.session = true;
    await expect(render(SignupPage)).rejects.toSatisfy((e) => redirectOf(e) === "/");
  });
});
