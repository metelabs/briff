import { afterAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db/client";
import { resetEnvCache } from "@/lib/env";
import { getAuth } from "./auth";
import { signUpAction } from "@/app/login/actions";

const requestContext = vi.hoisted(() => ({ ip: "192.0.2.51" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": requestContext.ip }),
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect");
  },
}));

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("open signup window", () => {
  const names: string[] = [];
  const emails: string[] = [];
  afterAll(async () => {
    const db = getDb();
    await db.org.deleteMany({ where: { name: { in: names } } });
    await db.user.deleteMany({ where: { email: { in: emails } } });
    await db.$disconnect();
    vi.unstubAllEnvs();
    resetEnvCache();
  });
  it("defaults to open signup, creates bounded orgs without requiring verification, and limits each IP", async () => {
    vi.stubEnv("DATABASE_URL", url ?? "");
    vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-test-secret-of-at-least-32-characters");
    vi.stubEnv("BETTER_AUTH_URL", "https://example.com");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ALLOW_SIGNUP", undefined);
    resetEnvCache();
    const signup = async (ip: string) => {
      const key = crypto.randomUUID();
      const name = `Acme signup ${key}`;
      const email = `acme-signup-${key}@example.com`;
      names.push(name);
      emails.push(email);
      return getAuth().handler(
        new Request("https://example.com/api/auth/sign-up/email", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://example.com",
            "x-real-ip": ip,
          },
          body: JSON.stringify({ name, email, password: crypto.randomUUID() }),
        })
      );
    };
    for (let i = 0; i < 5; i++) expect((await signup("192.0.2.41")).status).toBe(200);
    expect((await signup("192.0.2.41")).status).toBe(429);
    expect((await signup("192.0.2.42")).status).toBe(200);
    const db = getDb();
    const org = await db.org.findFirstOrThrow({ where: { name: names[0] } });
    expect(org.repoLimit).toBe(10);
    expect(org.streamLimit).toBe(2);
    expect((await db.user.findUniqueOrThrow({ where: { email: emails[0] } })).emailVerified).toBe(
      false
    );
    vi.stubEnv("ALLOW_SIGNUP", "false");
    resetEnvCache();
    expect((await signup("192.0.2.43")).status).toBe(403);
  }, 30000);

  it("enforces the shared window when the login Server Action calls the auth API directly", async () => {
    vi.stubEnv("ALLOW_SIGNUP", "true");
    resetEnvCache();
    const attempt = async (viaHttp = false) => {
      const key = crypto.randomUUID();
      const name = `Acme action ${key}`;
      const email = `acme-action-${key}@example.com`;
      names.push(name);
      emails.push(email);
      const form = new FormData();
      form.set("name", name);
      form.set("email", email);
      form.set("password", crypto.randomUUID());
      if (viaHttp) {
        const response = await getAuth().handler(
          new Request("https://example.com/api/auth/sign-up/email", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: "https://example.com",
              "x-real-ip": requestContext.ip,
            },
            body: JSON.stringify(Object.fromEntries(form)),
          })
        );
        expect(response.status).toBe(200);
        return { error: null };
      }
      return signUpAction({ error: null }, form);
    };
    await attempt(true);
    for (let i = 0; i < 4; i++) await expect(attempt()).rejects.toThrow("redirect");
    await expect(attempt()).resolves.toEqual({
      error: "Too many sign-up attempts. Try again in one hour.",
    });
    expect(await getDb().user.count({ where: { email: emails.at(-1) } })).toBe(0);
    requestContext.ip = "192.0.2.52";
    await expect(attempt()).rejects.toThrow("redirect");
  }, 30000);
});
