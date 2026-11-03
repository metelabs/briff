import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { resetEnvCache } from "@/lib/env";
import { utcDay } from "@/lib/llm-budget";
import { log } from "@/lib/log";

import { loadBulletinView } from "./bulletin-view";

// Past its monthly LLM budget an org still gets its bulletin: the triage model writes a
// condensed edition. Every synthesis lands in the org's usage rollup, and crossing the budget
// queues one email per owner (billing-notify) plus an operator alert, once per month.

vi.mock("@/lib/email/mailer", () => ({
  smtpConfig: () => null,
  sendMail: async () => ({ status: "skipped", reason: "test" }),
}));

const { weeklyBulletin } = await import("./weekly");

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("weekly bulletin under the monthly LLM budget", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  const saved = { ...process.env };
  const orgIds: string[] = [];
  const sourceIds: string[] = [];
  let userId = "";
  let overOrg = "";
  let underOrg = "";

  async function orgWithItem(name: string, plan: "free" | "pro"): Promise<string> {
    const orgId = (await db.org.create({ data: { name: `${name}-${suffix}`, plan } })).id;
    orgIds.push(orgId);
    const scoped = withOrg(db, orgId);
    const stream = await scoped.bulletinStream.create({
      data: { orgId, name: "Weekly", slug: `weekly-${name}-${suffix}` },
    });
    const repoId = (
      await scoped.repo.create({
        data: { orgId, name: "garden.example", source: "github", included: true },
      })
    ).id;
    await scoped.streamRepo.create({ data: { orgId, streamId: stream.id, repoId } });
    const pkg = `acme-ui-${name}-${suffix}`;
    const packageId = (await db.package.create({ data: { ecosystem: "npm", name: pkg } })).id;
    const source = await db.source.create({
      data: {
        kind: "github_releases",
        url: `https://github.com/budget-${suffix}/${name}/releases.atom`,
        name: `budget/${name} releases`,
      },
    });
    sourceIds.push(source.id);
    const item = await db.item.create({
      data: {
        sourceId: source.id,
        title: `${pkg} 3.0.0`,
        url: `https://github.com/budget-${suffix}/${name}/releases/tag/3.0.0`,
        rawText: "Drops IE.",
        contentHash: `budget-${name}-${suffix}`,
        publishedAt: new Date(Date.now() - 86_400_000),
      },
    });
    await db.itemTriage.create({
      data: {
        itemId: item.id,
        bucket: "breaking_or_feature",
        packages: [],
        model: "m",
        promptVersion: "p",
      },
    });
    await scoped.itemMatch.create({
      data: {
        orgId,
        itemId: item.id,
        packageId,
        repoIds: [repoId],
        reason: `release:${pkg}`,
        score: 1,
      },
    });
    return orgId;
  }

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: url,
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "http://127.0.0.1:3000",
      BRIFF_LLM_FAKE: "true",
      BRIFF_LLM_BATCH: "false",
      BRIFF_CLOUD: "true",
      BRIFF_MODEL_TRIAGE: "claude-haiku-5-5",
      BRIFF_MODEL_SYNTHESIS: "claude-sonnet-5-5",
      NODE_ENV: "test",
    });
    resetEnvCache();
    userId = (
      await db.user.create({
        data: {
          id: `u-budget-${suffix}`,
          name: "Owner",
          email: `owner-budget-${suffix}@example.com`,
        },
      })
    ).id;
    overOrg = await orgWithItem("over", "free");
    underOrg = await orgWithItem("under", "pro");
    await withOrg(db, overOrg).orgMember.create({
      data: { orgId: overOrg, userId, role: "owner" },
    });
    // $0.60 already spent this month against Free's $0.50.
    await withOrg(db, overOrg).orgUsage.create({
      data: { orgId: overOrg, day: utcDay(new Date()), estimatedUsdMicros: 600_000, requests: 3 },
    });
    await weeklyBulletin({
      db,
      log,
      jobId: `budget-${suffix}`,
      payload: {},
      heartbeat: async () => {},
    });
  });

  afterAll(async () => {
    await db.job.deleteMany({ where: { dedupeKey: { contains: suffix } } });
    await db.job.deleteMany({ where: { dedupeKey: { contains: overOrg } } });
    await db.opsAlert.deleteMany({ where: { jobType: { contains: overOrg } } });
    await db.opsAlert.deleteMany({ where: { jobType: { contains: underOrg } } });
    await db.org.deleteMany({ where: { id: { in: orgIds } } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.source.deleteMany({ where: { id: { in: sourceIds } } });
    await db.package.deleteMany({ where: { name: { contains: suffix } } });
    await db.$disconnect();
    process.env = saved;
    resetEnvCache();
  });

  const bulletinOf = (orgId: string) =>
    withOrg(db, orgId).bulletin.findFirstOrThrow({
      select: { id: true, model: true, condensed: true },
    });

  it("writes a condensed edition with the triage model for the org past its budget", async () => {
    const over = await bulletinOf(overOrg);
    expect(over).toMatchObject({ model: "fake:claude-haiku-5-5", condensed: true });
    const view = await loadBulletinView(db, overOrg, over.id);
    expect(view?.condensed).toBe(true);
    const under = await bulletinOf(underOrg);
    expect(under).toMatchObject({ model: "fake:claude-sonnet-5-5", condensed: false });
  });

  it("adds each synthesis to the org's own usage row", async () => {
    const [over] = await withOrg(db, overOrg).orgUsage.findMany();
    expect(over).toMatchObject({ requests: 4, bulletins: 1, estimatedUsdMicros: 600_000 });
    expect(over.inputTokens).toBeGreaterThan(0);
    const [under] = await withOrg(db, underOrg).orgUsage.findMany();
    expect(under).toMatchObject({ requests: 1, bulletins: 1, estimatedUsdMicros: 0 });
  });

  it("queues one budget email per owner and an operator alert, once per month", async () => {
    const jobs = await db.job.findMany({
      where: { type: "billing-notify", dedupeKey: { contains: overOrg } },
      select: { payload: true },
    });
    expect(jobs.map((j) => j.payload)).toEqual([
      {
        orgId: overOrg,
        userId,
        kind: "llm-budget",
        threshold: 100,
        spentUsd: 0.6,
        budgetUsd: 0.5,
      },
    ]);
    const org = await db.org.findUniqueOrThrow({
      where: { id: overOrg },
      select: { llmBudgetNotifiedPct: true, llmBudgetNotifiedMonth: true },
    });
    expect(org.llmBudgetNotifiedPct).toBe(100);
    expect(
      await db.opsAlert.count({ where: { kind: "budget", jobType: { contains: overOrg } } })
    ).toBe(1);
    // The org under its budget got nothing.
    expect(await db.job.count({ where: { dedupeKey: { contains: underOrg } } })).toBe(0);

    const { notifyBudgetThreshold } = await import("@/lib/llm-budget-notify");
    expect(await notifyBudgetThreshold(db, overOrg, log)).toBe("none");
    expect(
      await db.job.count({ where: { type: "billing-notify", dedupeKey: { contains: overOrg } } })
    ).toBe(1);
  });

  it("keeps a stored edition when only the budget mode changed (no second email)", async () => {
    const before = await withOrg(db, underOrg).bulletin.findFirstOrThrow({
      select: { id: true, updatedAt: true },
    });
    // Pro's $3 is now used up, but the week's input is the same.
    await withOrg(db, underOrg).orgUsage.updateMany({ data: { estimatedUsdMicros: 5_000_000 } });
    await weeklyBulletin({
      db,
      log,
      jobId: `budget-rerun-${suffix}`,
      payload: {},
      heartbeat: async () => {},
    });
    const after = await withOrg(db, underOrg).bulletin.findFirstOrThrow({
      select: { id: true, updatedAt: true, model: true, condensed: true },
    });
    expect(after).toMatchObject({
      id: before.id,
      updatedAt: before.updatedAt,
      model: "fake:claude-sonnet-5-5",
      condensed: false,
    });
    // No request this run, but the threshold notice is still checked (and claimed once).
    const org = await db.org.findUniqueOrThrow({
      where: { id: underOrg },
      select: { llmBudgetNotifiedPct: true },
    });
    expect(org.llmBudgetNotifiedPct).toBe(100);
  });
});
