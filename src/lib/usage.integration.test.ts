import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { resetEnvCache } from "@/lib/env";
import { log } from "@/lib/log";

import { notifyBudgetThreshold } from "./llm-budget-notify";
import { loadMonthUsage, loadOrgBudget, recordLlmUsage, takeScanUpload } from "./usage";

vi.mock("@/lib/email/mailer", () => ({
  smtpConfig: () => null,
  sendMail: async () => ({ status: "skipped", reason: "test" }),
}));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("OrgUsage rollup", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  const saved = { ...process.env };
  let a = "";
  let b = "";
  const nov = new Date("2026-11-03T10:00:00Z");

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: url,
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "http://127.0.0.1:3000",
      BRIFF_CLOUD: "true",
      NODE_ENV: "test",
    });
    resetEnvCache();
    a = (await db.org.create({ data: { name: `usage-a-${suffix}`, plan: "pro" } })).id;
    b = (await db.org.create({ data: { name: `usage-b-${suffix}`, plan: "free" } })).id;
  });

  afterAll(async () => {
    await db.job.deleteMany({ where: { dedupeKey: { contains: a } } });
    await db.opsAlert.deleteMany({ where: { jobType: { contains: a } } });
    await db.org.deleteMany({ where: { id: { in: [a, b] } } });
    await db.$disconnect();
    process.env = saved;
    resetEnvCache();
  });

  it("adds requests to the org's day and prices them, keeping every org to its own rows", async () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 100_000 };
    await recordLlmUsage(
      db,
      a,
      { task: "synthesis", model: "claude-sonnet-5-5", usage, batch: true, bulletin: true },
      nov
    );
    await recordLlmUsage(
      db,
      a,
      { task: "profile", model: "claude-haiku-5-5", usage, batch: false },
      new Date("2026-11-03T23:59:00Z")
    );
    // Last month and another org: neither counts for a this month.
    await recordLlmUsage(
      db,
      a,
      { task: "synthesis", model: "claude-sonnet-5-5", usage, batch: false },
      new Date("2026-10-31T12:00:00Z")
    );
    await recordLlmUsage(
      db,
      b,
      { task: "synthesis", model: "fake:claude-sonnet-5-5", usage, batch: false },
      nov
    );

    const month = await loadMonthUsage(db, a, nov);
    // Sonnet batch 1.5 + Haiku 0.15.
    expect(month).toEqual({
      requests: 2,
      bulletins: 1,
      inputTokens: 2_000_000,
      outputTokens: 200_000,
      usd: 1.65,
    });
    expect(await withOrg(db, a).orgUsage.count()).toBe(2);
    expect(await withOrg(db, b).orgUsage.findMany({ select: { orgId: true } })).toEqual([
      { orgId: b },
    ]);
    // The fake is unpriced: tokens on record, no cost.
    expect(await loadMonthUsage(db, b, nov)).toMatchObject({ requests: 1, usd: 0 });
    expect(await loadOrgBudget(db, a, nov)).toEqual({
      budgetUsd: 3,
      spentUsd: 1.65,
      economy: false,
    });
  });

  it("counts scan uploads per day up to the limit, atomically", async () => {
    const day = new Date("2026-11-04T08:00:00Z");
    const results = await Promise.all(
      Array.from({ length: 5 }, () => takeScanUpload(db, b, 3, day))
    );
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(await takeScanUpload(db, b, 3, new Date("2026-11-05T00:00:01Z"))).toBe(true);
    expect(await takeScanUpload(db, b, null, day)).toBe(true);
    const rows = await withOrg(db, b).orgUsage.findMany({
      where: { day: { gte: new Date("2026-11-04") } },
      orderBy: { day: "asc" },
      select: { scanUploads: true },
    });
    expect(rows.map((r) => r.scanUploads)).toEqual([4, 1]);
  });

  it("tells owners at 80 % and at 100 % once each, and again next month", async () => {
    const user = await db.user.create({
      data: { id: `u-usage-${suffix}`, name: "O", email: `o-usage-${suffix}@example.com` },
    });
    await withOrg(db, a).orgMember.create({ data: { orgId: a, userId: user.id, role: "owner" } });
    const jobs = () =>
      db.job.findMany({
        where: { type: "billing-notify", dedupeKey: { contains: a } },
        orderBy: { createdAt: "asc" },
        select: { payload: true },
      });
    try {
      // 1.65 of 3: under 80 %.
      expect(await notifyBudgetThreshold(db, a, log, nov)).toBe("none");
      await recordLlmUsage(
        db,
        a,
        {
          task: "synthesis",
          model: "claude-sonnet-5-5",
          usage: { inputTokens: 400_000, outputTokens: 0 },
          batch: false,
        },
        nov
      );
      // 2.45 of 3.
      expect(await notifyBudgetThreshold(db, a, log, nov)).toBe("80");
      expect(await notifyBudgetThreshold(db, a, log, nov)).toBe("none");
      await recordLlmUsage(
        db,
        a,
        {
          task: "synthesis",
          model: "claude-sonnet-5-5",
          usage: { inputTokens: 300_000, outputTokens: 0 },
          batch: false,
        },
        nov
      );
      expect(await loadOrgBudget(db, a, nov)).toMatchObject({ economy: true });
      expect(await notifyBudgetThreshold(db, a, log, nov)).toBe("100");
      expect(await notifyBudgetThreshold(db, a, log, nov)).toBe("none");
      expect((await jobs()).map((j) => (j.payload as { threshold: number }).threshold)).toEqual([
        80, 100,
      ]);
      expect(await db.opsAlert.count({ where: { kind: "budget", jobType: { contains: a } } })).toBe(
        2
      );

      // December starts from zero; a spend past 100 % right away skips the 80 % email.
      const dec = new Date("2026-12-02T09:00:00Z");
      expect(await notifyBudgetThreshold(db, a, log, dec)).toBe("none");
      await recordLlmUsage(
        db,
        a,
        {
          task: "synthesis",
          model: "claude-sonnet-5-5",
          usage: { inputTokens: 2_000_000, outputTokens: 0 },
          batch: false,
        },
        dec
      );
      expect(await notifyBudgetThreshold(db, a, log, dec)).toBe("100");
      expect(await jobs()).toHaveLength(3);
    } finally {
      await db.user.deleteMany({ where: { id: user.id } });
    }
  });

  it("has no budget on a self-hosted instance", async () => {
    process.env.BRIFF_CLOUD = "false";
    resetEnvCache();
    try {
      expect(await loadOrgBudget(db, a, nov)).toEqual({
        budgetUsd: null,
        spentUsd: 0,
        economy: false,
      });
      expect(await notifyBudgetThreshold(db, a, log, nov)).toBe("none");
    } finally {
      process.env.BRIFF_CLOUD = "true";
      resetEnvCache();
    }
  });
});
