import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { resetEnvCache } from "@/lib/env";
import { log } from "@/lib/log";

import { ALERT_WINDOW_MS, sendOpsAlert } from "./alerts";
import { opsCheck } from "./check";

const mail = vi.hoisted(() => ({
  sent: [] as { to: string; subject: string; html: string }[],
  fail: false,
  skip: false,
}));
vi.mock("@/lib/email/mailer", () => ({
  sendMail: async (message: { to: string; subject: string; html: string }) => {
    if (mail.fail) return { status: "failed", error: "535 auth" };
    if (mail.skip) return { status: "skipped", reason: "SMTP_* / FROM_EMAIL not set" };
    mail.sent.push(message);
    return { status: "sent", messageId: "m" };
  },
}));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("ops alerts against Postgres", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const jobType = `test-job-${Date.now().toString(36)}`;
  const posts: unknown[] = [];
  let webhookStatus = 200;
  let server: Server;
  let webhookUrl = "";

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        posts.push(JSON.parse(body));
        res.statusCode = webhookStatus;
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    webhookUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  });

  beforeEach(async () => {
    vi.stubEnv("DATABASE_URL", url ?? "");
    vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-test-secret-with-at-least-32-characters");
    vi.stubEnv("BETTER_AUTH_URL", "https://briff.example.com");
    vi.stubEnv("ALERT_WEBHOOK_URL", webhookUrl);
    vi.stubEnv("OPS_ALERT_EMAIL", "ops@example.com, oncall@example.com");
    resetEnvCache();
    mail.sent = [];
    mail.fail = false;
    mail.skip = false;
    posts.length = 0;
    webhookStatus = 200;
    await db.opsAlert.deleteMany({ where: { jobType } });
    await db.job.deleteMany({ where: { type: jobType } });
  });

  afterAll(async () => {
    await db.opsAlert.deleteMany({ where: { jobType } });
    await db.job.deleteMany({ where: { type: jobType } });
    await db.$disconnect();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  const failure = { kind: "failed" as const, jobType, at: new Date(), error: "Error: boom\n at x" };

  it("emails every operator and posts the webhook once, then dedupes for 24h", async () => {
    const now = new Date("2026-11-02T04:00:00Z");
    expect(await sendOpsAlert(db, failure, log, now)).toBe("sent");
    expect(mail.sent.map((m) => m.to)).toEqual(["ops@example.com", "oncall@example.com"]);
    expect(mail.sent[0].subject).toBe(`Briff · Job failed: ${jobType}`);
    expect(posts).toEqual([
      expect.objectContaining({ kind: "failed", job: jobType, error: "Error: boom\n at x" }),
    ]);
    expect((posts[0] as { text: string }).text).toContain(`Job failed: ${jobType}`);

    const later = new Date(now.getTime() + ALERT_WINDOW_MS - 60_000);
    expect(await sendOpsAlert(db, failure, log, later)).toBe("deduped");
    expect(await sendOpsAlert(db, failure, log, later)).toBe("deduped");
    expect(mail.sent).toHaveLength(2);
    expect(posts).toHaveLength(1);
    const row = await db.opsAlert.findUniqueOrThrow({
      where: { jobType_kind: { jobType, kind: "failed" } },
    });
    expect(row).toMatchObject({ lastSentAt: now, suppressed: 2 });

    // A stale alert for the same job is its own slot.
    expect(await sendOpsAlert(db, { kind: "stale", jobType, at: now }, log, later)).toBe("sent");

    const nextDay = new Date(now.getTime() + ALERT_WINDOW_MS);
    expect(await sendOpsAlert(db, failure, log, nextDay)).toBe("sent");
    expect(mail.sent.at(-1)?.html).toContain("2 more alerts of this kind were held back");
    const after = await db.opsAlert.findUniqueOrThrow({
      where: { jobType_kind: { jobType, kind: "failed" } },
    });
    expect(after).toMatchObject({ lastSentAt: nextDay, suppressed: 0 });
  });

  it("releases the slot when every configured channel fails, so the next attempt sends", async () => {
    const now = new Date("2026-11-03T04:00:00Z");
    mail.fail = true;
    webhookStatus = 500;
    expect(await sendOpsAlert(db, failure, log, now)).toBe("failed");
    expect(await db.opsAlert.count({ where: { jobType } })).toBe(0);

    // One channel is enough: delivered, and the slot is kept.
    webhookStatus = 200;
    expect(await sendOpsAlert(db, failure, log, now)).toBe("sent");
    expect(await db.opsAlert.count({ where: { jobType } })).toBe(1);
  });

  it("keeps the slot when no channel is configured (the log line is the alert)", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "");
    resetEnvCache();
    mail.skip = true;
    const now = new Date("2026-11-04T04:00:00Z");
    expect(await sendOpsAlert(db, failure, log, now)).toBe("skipped");
    expect(await sendOpsAlert(db, failure, log, now)).toBe("deduped");
    expect(posts).toHaveLength(0);
  });

  it("ops-check retries a recent failure whose alert was not delivered, without counting it twice", async () => {
    await db.job.create({
      data: {
        type: jobType,
        dedupeKey: jobType,
        status: "failed",
        attempts: 5,
        lastError: "Error: SMTP was down too",
      },
    });
    const ctx = { db, log, jobId: "ops-check-test", payload: {}, heartbeat: async () => {} };
    await opsCheck(ctx);
    const row = await db.opsAlert.findUniqueOrThrow({
      where: { jobType_kind: { jobType, kind: "failed" } },
    });
    expect(row.suppressed).toBe(0);
    expect(mail.sent.filter((m) => m.subject.includes(jobType))).toHaveLength(2);
    // Other test files may leave failures of their own; only this job type is ours.
    const ours = () => posts.filter((p) => (p as { job: string }).job === jobType);
    expect(ours()).toEqual([
      expect.objectContaining({ job: jobType, error: "Error: SMTP was down too" }),
    ]);

    // Delivered: the next tick dedupes and does not count the same failure as held back.
    await opsCheck(ctx);
    expect(ours()).toHaveLength(1);
    const again = await db.opsAlert.findUniqueOrThrow({
      where: { jobType_kind: { jobType, kind: "failed" } },
    });
    expect(again.suppressed).toBe(0);
  });
});
