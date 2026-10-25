import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { resetEnvCache } from "@/lib/env";
import { log } from "@/lib/log";

import { weekStartOf } from "./bulletin";
import { deliverBulletin } from "./deliver";
import { bulletinPreview } from "./preview";

// Runs only when TEST_DATABASE_URL points at a migrated, disposable database.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("bulletin-preview against Postgres", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  const saved = { ...process.env };
  let orgId = "";
  let streamId = "";
  let sourceId = "";

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: url,
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "http://127.0.0.1:3000",
      BRIFF_LLM_FAKE: "true",
      NODE_ENV: "test",
    });
    resetEnvCache();
    orgId = (await db.org.create({ data: { name: `p-${suffix}` } })).id;
    const scoped = withOrg(db, orgId);
    const repo = await scoped.repo.create({
      data: { orgId, name: `garden-${suffix}`, source: "local", included: true },
    });
    const stream = await scoped.bulletinStream.create({
      data: { orgId, name: "Work", slug: `work-${suffix}` },
    });
    streamId = stream.id;
    await scoped.streamRepo.create({ data: { orgId, streamId, repoId: repo.id } });
    sourceId = (
      await db.source.create({
        data: { kind: "rss", url: `https://example.com/${suffix}.xml`, name: "Example blog" },
      })
    ).id;
    const item = await db.item.create({
      data: {
        sourceId,
        title: "Next.js 16.5 introduces a new cache API",
        url: `https://example.com/${suffix}`,
        rawText: "Introducing a new cache API.",
        contentHash: `hash-${suffix}`,
        publishedAt: new Date(),
      },
    });
    await db.itemTriage.create({
      data: { itemId: item.id, bucket: "breaking_or_feature", model: "m", promptVersion: "p" },
    });
    await scoped.itemMatch.create({
      data: { orgId, itemId: item.id, repoIds: [repo.id], reason: "service:nextjs", score: 0.8 },
    });
  });

  afterAll(async () => {
    await db.org.deleteMany({ where: { id: orgId } });
    await db.source.deleteMany({ where: { id: sourceId } });
    await db.$disconnect();
    process.env = saved;
    resetEnvCache();
  });

  it("stores one preview per model next to the week's bulletin and never emails it", async () => {
    const scoped = withOrg(db, orgId);
    const weekStart = weekStartOf(new Date());
    const real = await scoped.bulletin.create({
      data: {
        orgId,
        streamId,
        weekStart,
        model: "claude-sonnet-5-5",
        promptVersion: "p",
        summary: "real",
        inputHash: "real-hash",
      },
    });
    const ctx = (model: string) => ({
      db,
      log,
      jobId: "job",
      payload: { orgId, streamId, model },
      heartbeat: async () => {},
    });

    const first = await bulletinPreview(ctx("claude-haiku-5-5"));
    expect(first.counts).toMatchObject({ generated: 1 });
    expect(first.counts?.inputChars).toBeGreaterThan(0);
    await bulletinPreview(ctx("claude-haiku-5-5"));
    await bulletinPreview(ctx("claude-sonnet-5-5"));

    const rows = await scoped.bulletin.findMany({
      where: { streamId, weekStart },
      orderBy: { previewKey: "asc" },
      select: {
        id: true,
        preview: true,
        previewKey: true,
        model: true,
        inputHash: true,
        emailStatus: true,
      },
    });
    expect(rows.map((r) => [r.preview, r.previewKey, r.model])).toEqual([
      [false, "", "claude-sonnet-5-5"],
      [true, "claude-haiku-5-5", "fake:claude-haiku-5-5"],
      [true, "claude-sonnet-5-5", "fake:claude-sonnet-5-5"],
    ]);
    // The real bulletin's input hash (the regenerate-skip) is untouched.
    expect(rows[0]).toMatchObject({ id: real.id, inputHash: "real-hash" });
    expect(rows[1].emailStatus).toBe("skipped");
    expect(await scoped.bulletinItem.count({ where: { bulletinId: rows[1].id } })).toBe(1);
    await expect(deliverBulletin(db, orgId, rows[1].id, log)).rejects.toThrow(/preview/);
  });

  it("rejects a payload it cannot use without failing the job", async () => {
    const res = await bulletinPreview({
      db,
      log,
      jobId: "job",
      payload: { orgId, streamId, model: "gpt-9" },
      heartbeat: async () => {},
    });
    expect(res.counts).toMatchObject({ invalidPayload: 1 });
  });
});
