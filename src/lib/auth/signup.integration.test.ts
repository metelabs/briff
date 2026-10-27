import { afterAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db/client";
import { resetEnvCache } from "@/lib/env";
import { getAuth } from "./auth";

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
});
