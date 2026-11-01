import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { resetEnvCache } from "@/lib/env";
import { log } from "@/lib/log";

import { loadBulletinView, restCount } from "./bulletin-view";

// The folded-away bar used to open on "Also N minor updates, not listed." only: minor items
// were counted, never stored. They are stored as bucket `minor` rows now, and an unchanged
// rerun (same input hash) writes them for a bulletin stored before.

vi.mock("@/lib/email/mailer", () => ({
  smtpConfig: () => null,
  sendMail: async () => ({ status: "skipped" }),
}));

const { weeklyBulletin } = await import("./weekly");

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("weekly bulletin: minor updates are listed", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  const saved = { ...process.env };
  let orgId = "";
  const sourceIds: string[] = [];
  const itemIds = new Map<string, string>();

  const run = () =>
    weeklyBulletin({ db, log, jobId: `minor-${suffix}`, payload: {}, heartbeat: async () => {} });
  const bulletinId = async () =>
    (await withOrg(db, orgId).bulletin.findFirstOrThrow({ select: { id: true } })).id;

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: url,
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "http://127.0.0.1:3000",
      BRIFF_LLM_FAKE: "true",
      BRIFF_LLM_BATCH: "false",
      NODE_ENV: "test",
    });
    resetEnvCache();
    orgId = (await db.org.create({ data: { name: `minor-${suffix}` } })).id;
    const scoped = withOrg(db, orgId);
    const stream = await scoped.bulletinStream.create({
      data: { orgId, name: "Weekly", slug: `weekly-${suffix}` },
    });
    const repoId = (
      await scoped.repo.create({
        data: { orgId, name: "garden.example", source: "github", included: true },
      })
    ).id;
    await scoped.streamRepo.create({ data: { orgId, streamId: stream.id, repoId } });
    const yesterday = Date.now() - 86_400_000;
    const items = [
      {
        key: "feature",
        title: "acme-ui 3.0.0",
        bucket: "breaking_or_feature" as const,
        text: "Drops IE.",
      },
      {
        key: "patch",
        title: "acme-http 1.4.2",
        bucket: "minor" as const,
        text: "## Patch Changes\n\n- 9a8b7c6: Fix the retry loop on 503",
      },
      {
        key: "canary",
        title: "acme-cli 2.0.0-canary.4",
        bucket: "breaking_or_feature" as const,
        text: "",
      },
    ];
    for (const [i, f] of items.entries()) {
      const pkg = f.title.split(" ")[0];
      const packageId = (
        await db.package.upsert({
          where: { ecosystem_name: { ecosystem: "npm", name: `${pkg}-${suffix}` } },
          create: { ecosystem: "npm", name: `${pkg}-${suffix}` },
          update: {},
        })
      ).id;
      const source = await db.source.create({
        data: {
          kind: "github_releases",
          url: `https://github.com/minor-${suffix}/${f.key}/releases.atom`,
          name: `minor/${f.key} releases`,
        },
      });
      sourceIds.push(source.id);
      const item = await db.item.create({
        data: {
          sourceId: source.id,
          title: f.title,
          url: `https://github.com/minor-${suffix}/${f.key}/releases/tag/1`,
          rawText: f.text,
          contentHash: `minor-${f.key}-${suffix}`,
          publishedAt: new Date(yesterday + i * 60_000),
        },
      });
      itemIds.set(f.key, item.id);
      await db.itemTriage.create({
        data: { itemId: item.id, bucket: f.bucket, packages: [], model: "m", promptVersion: "p" },
      });
      await scoped.itemMatch.create({
        data: {
          orgId,
          itemId: item.id,
          packageId,
          repoIds: [repoId],
          reason: `release:${pkg}-${suffix}`,
          score: 1,
        },
      });
    }
    await run();
  });

  afterAll(async () => {
    await db.org.deleteMany({ where: { id: orgId } });
    await db.source.deleteMany({ where: { id: { in: sourceIds } } });
    await db.$disconnect();
    process.env = saved;
    resetEnvCache();
  });

  it("stores the counted minor items and the page view lists them apart from rest", async () => {
    const view = await loadBulletinView(db, orgId, await bulletinId());
    expect(view?.minorCount).toBe(2);
    expect(view?.minor.map((i) => [i.itemId, i.title, i.line, i.affectedRepos])).toEqual([
      [itemIds.get("canary"), "acme-cli 2.0.0-canary.4", "", ["garden.example"]],
      [itemIds.get("patch"), "acme-http 1.4.2", "Fix the retry loop on 503", ["garden.example"]],
    ]);
    expect(view?.rest.some((i) => i.bucket === "minor")).toBe(false);
    expect([...(view?.act ?? []), ...(view?.know ?? [])].map((i) => i.itemId)).toContain(
      itemIds.get("feature")
    );
    // The count already includes the listed rows.
    expect(view && restCount(view)).toBe((view?.rest.length ?? 0) + 2);
  });

  it("writes the minor rows on an unchanged rerun for a bulletin stored without them", async () => {
    const id = await bulletinId();
    const scoped = withOrg(db, orgId);
    await scoped.bulletinItem.deleteMany({ where: { bulletinId: id, bucket: "minor" } });
    const before = await scoped.bulletin.findFirstOrThrow({ select: { inputHash: true } });
    const res = await run();
    expect(Number(res.counts?.unchanged)).toBeGreaterThanOrEqual(1);
    const after = await scoped.bulletin.findFirstOrThrow({ select: { id: true, inputHash: true } });
    expect(after).toEqual({ id, inputHash: before.inputHash });
    const view = await loadBulletinView(db, orgId, id);
    expect(view?.minor.map((i) => i.itemId)).toEqual([itemIds.get("canary"), itemIds.get("patch")]);
  });
});
