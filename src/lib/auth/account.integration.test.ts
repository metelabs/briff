import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/db/client";
import type { MailMessage } from "@/lib/email/mailer";
import { orgRecipients } from "@/lib/email/recipients";
import { resetEnvCache } from "@/lib/env";

import { getAuth } from "./auth";

const sent = vi.hoisted(() => [] as MailMessage[]);
vi.mock("@/lib/email/mailer", () => ({
  smtpConfig: () => null,
  sendMail: async (message: MailMessage) => {
    sent.push(message);
    return { status: "sent", messageId: "test" };
  },
}));

const BASE = "https://example.com";
const url = process.env.TEST_DATABASE_URL;

function post(path: string, body: unknown, ip: string, cookie?: string): Promise<Response> {
  return getAuth().handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: BASE,
        "x-real-ip": ip,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    })
  );
}

function linkIn(message: MailMessage | undefined): string {
  const match = message?.text.match(/https:\/\/\S+/);
  if (!match) throw new Error("no link in email");
  return match[0];
}

describe.skipIf(!url)("account emails through Better Auth", () => {
  const key = crypto.randomUUID();
  const email = `acme-account-${key}@example.com`;
  const name = `Acme account ${key}`;
  let current = "";

  beforeAll(() => {
    vi.stubEnv("DATABASE_URL", url ?? "");
    vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-test-secret-of-at-least-32-characters");
    vi.stubEnv("BETTER_AUTH_URL", BASE);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ALLOW_SIGNUP", "true");
    resetEnvCache();
  });

  afterAll(async () => {
    const db = getDb();
    await db.org.deleteMany({ where: { name } });
    await db.user.deleteMany({ where: { email: { in: [email, `new-${email}`] } } });
    await db.$disconnect();
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("verifies on sign-up, resets a password once, and limits reset requests per IP", async () => {
    const password = crypto.randomUUID();
    const signUp = await post(
      "/sign-up/email",
      { name, email, password, callbackURL: "/settings?verified=1" },
      "192.0.2.61"
    );
    expect(signUp.status).toBe(200);
    const verifyMail = sent.find((m) => m.to === email);
    expect(verifyMail?.subject).toBe("Briff · verify your email address");
    const verify = await getAuth().handler(new Request(linkIn(verifyMail)));
    expect(verify.status).toBe(302);
    expect(verify.headers.get("location")).toBe("/settings?verified=1");
    const db = getDb();
    expect((await db.user.findUniqueOrThrow({ where: { email } })).emailVerified).toBe(true);

    const ip = "192.0.2.62";
    for (let i = 0; i < 3; i++) {
      expect(
        (await post("/request-password-reset", { email, redirectTo: "/reset-password" }, ip)).status
      ).toBe(200);
    }
    expect(
      (await post("/request-password-reset", { email, redirectTo: "/reset-password" }, ip)).status
    ).toBe(429);
    // Unknown addresses get the same answer.
    expect(
      (await post("/request-password-reset", { email: `nobody-${email}` }, "192.0.2.63")).status
    ).toBe(200);

    await vi.waitFor(() => expect(sent.filter((m) => m.subject.includes("reset")).length).toBe(3));
    const resetLink = linkIn(sent.findLast((m) => m.subject.includes("reset")));
    const callback = await getAuth().handler(new Request(resetLink));
    const location = new URL(callback.headers.get("location") ?? "", BASE);
    expect(location.pathname).toBe("/reset-password");
    const token = location.searchParams.get("token");
    expect(token).toBeTruthy();

    const newPassword = crypto.randomUUID();
    expect((await post("/reset-password", { token, newPassword }, "192.0.2.64")).status).toBe(200);
    expect((await post("/reset-password", { token, newPassword }, "192.0.2.64")).status).toBe(400);
    expect((await post("/sign-in/email", { email, password }, "192.0.2.64")).status).toBe(401);
    expect(
      (await post("/sign-in/email", { email, password: newPassword }, "192.0.2.64")).status
    ).toBe(200);
    current = newPassword;
  }, 30000);

  it("sends an email change to the new address and drops long-unverified members", async () => {
    const db = getDb();
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    const signIn = await post("/sign-in/email", { email, password: current }, "192.0.2.65");
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const change = await post(
      "/change-email",
      { newEmail: `new-${email}`, callbackURL: "/settings?verified=1" },
      "192.0.2.66",
      cookie
    );
    expect(change.status).toBe(200);
    const changeMail = sent.findLast((m) => m.to === `new-${email}`);
    expect(changeMail?.subject).toBe("Briff · confirm your new email address");

    const member = await db.orgMember.findFirstOrThrow({ where: { userId: user.id } });
    expect((await orgRecipients(db, member.orgId)).map((r) => r.userId)).toEqual([user.id]);
    await db.user.update({
      where: { id: user.id },
      data: { emailVerified: false, createdAt: new Date(Date.now() - 8 * 86_400_000) },
    });
    expect(await orgRecipients(db, member.orgId)).toEqual([]);
  }, 30000);
});
