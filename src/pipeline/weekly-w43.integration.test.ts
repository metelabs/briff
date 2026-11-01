import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { createFakeLlm } from "@/llm/fake";
import { loadPrompt } from "@/llm/prompts";

import { isoWeekLabel, weekStartOf } from "./bulletin";
import { prepareStream, storeBulletin, synthesisRequest, type SynthesisContext } from "./weekly";

// The W43 security items through the weekly path (prepare, fake synthesis, store):
// headlines name the fix for the installed lines, actions install it per line.
// Runs only when TEST_DATABASE_URL points at a migrated, disposable database.
const url = process.env.TEST_DATABASE_URL;

type Install = [repo: string, version: string, direct: boolean];

const PACKAGES: {
  name: string;
  title: string;
  installs: Install[];
  ranges: { introduced: string; fixed: string }[];
}[] = [
  {
    name: "fastify",
    title: "fastify v5.12.6",
    installs: [["garden.example", "5.8.5", true]],
    ranges: [{ introduced: "0", fixed: "5.12.7" }],
  },
  {
    name: "nodemailer",
    title: "nodemailer v10.1.2",
    installs: [
      ["briff", "10.1.1", true],
      ["garden.example", "9.0.3", true],
      ["west.garden.example", "9.0.3", true],
      ["mint-app", "6.9.15", false],
      ["pantheon", "7.0.11", false],
    ],
    // Fixed on 10.x only.
    ranges: [{ introduced: "0", fixed: "10.1.4" }],
  },
  {
    name: "undici",
    title: "undici v8.12.2",
    installs: [
      ["tracker", "7.22.0", true],
      ["budget", "6.21.0", true],
    ],
    ranges: [
      { introduced: "0", fixed: "6.23.0" },
      { introduced: "7.0.0", fixed: "7.30.1" },
    ],
  },
];

describe.skipIf(!url)("weekly path for the W43 security items", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  let orgId = "";
  let streamId = "";
  const repoIds: string[] = [];
  const sourceIds: string[] = [];
  const advisoryIds: string[] = [];

  beforeAll(async () => {
    orgId = (await db.org.create({ data: { name: `w43-${suffix}` } })).id;
    const scoped = withOrg(db, orgId);
    streamId = (
      await scoped.bulletinStream.create({ data: { orgId, name: "Weekly", slug: `w-${suffix}` } })
    ).id;
    const repos = new Map<string, string>();
    for (const name of new Set(PACKAGES.flatMap((p) => p.installs.map(([repo]) => repo)))) {
      const repo = await scoped.repo.create({
        data: { orgId, name, source: "local", included: true },
      });
      repos.set(name, repo.id);
      repoIds.push(repo.id);
      await scoped.streamRepo.create({ data: { orgId, streamId, repoId: repo.id } });
    }
    for (const p of PACKAGES) {
      const pkg = await db.package.upsert({
        where: { ecosystem_name: { ecosystem: "npm", name: p.name } },
        create: { ecosystem: "npm", name: p.name },
        update: {},
      });
      const source = await db.source.create({
        data: {
          kind: "github_releases",
          url: `https://github.com/${p.name}/${p.name}/releases.atom?${suffix}`,
          name: `${p.name}/${p.name} releases`,
          packageId: pkg.id,
        },
      });
      sourceIds.push(source.id);
      const item = await db.item.create({
        data: {
          sourceId: source.id,
          title: p.title,
          url: `https://github.com/${p.name}/${p.name}/releases/${suffix}`,
          rawText: `Security release of ${p.name}.`,
          contentHash: `w43-${p.name}-${suffix}`,
          publishedAt: new Date(),
        },
      });
      await db.itemTriage.create({
        data: {
          itemId: item.id,
          bucket: "security",
          packages: [p.name],
          model: "m",
          promptVersion: "p",
        },
      });
      const affected = p.installs.map(([repo]) => repos.get(repo) as string);
      await scoped.itemMatch.create({
        data: {
          orgId,
          itemId: item.id,
          packageId: pkg.id,
          repoIds: affected,
          reason: `release:${p.name}`,
          score: 0.9,
        },
      });
      const advisory = await db.advisory.create({
        data: {
          osvId: `GHSA-w43-${p.name}-${suffix}`,
          packageId: pkg.id,
          severity: "HIGH",
          affected: p.ranges.map((r) => ({
            type: "SEMVER",
            events: [{ introduced: r.introduced }, { fixed: r.fixed }],
          })),
        },
      });
      advisoryIds.push(advisory.id);
      for (const [repo, version, direct] of p.installs) {
        const repoId = repos.get(repo) as string;
        await scoped.dependency.create({
          data: { orgId, repoId, packageId: pkg.id, installedVersion: version, direct },
        });
        await scoped.alert.create({
          data: { orgId, advisoryId: advisory.id, repoId, kind: "new" },
        });
      }
    }
  });

  afterAll(async () => {
    await db.org.deleteMany({ where: { id: orgId } });
    await db.advisory.deleteMany({ where: { id: { in: advisoryIds } } });
    await db.source.deleteMany({ where: { id: { in: sourceIds } } });
    await db.$disconnect();
  });

  it("stores the fix version in the headline and the per-line command as the action", async () => {
    const prompt = loadPrompt("synthesis");
    const now = new Date();
    const ctx: SynthesisContext = {
      now,
      weekStart: weekStartOf(now),
      week: isoWeekLabel(now),
      language: "en",
      model: "claude-haiku-5-5",
      promptVersion: prompt.version,
    };
    const stream = { id: streamId, name: "Weekly", repoIds };
    const prepared = await prepareStream(db, orgId, stream, ctx);
    expect(prepared).not.toBeNull();
    if (!prepared) return;
    const res = await createFakeLlm().json(synthesisRequest(prepared, ctx.model, prompt.text));
    const { bulletinId } = await storeBulletin(db, prepared, res, ctx);
    const items = await withOrg(db, orgId).bulletinItem.findMany({
      where: { bulletinId },
      orderBy: { order: "asc" },
      select: { section: true, headline: true, action: true },
    });
    expect(items.sort((a, b) => a.headline.localeCompare(b.headline))).toEqual([
      { section: "act", headline: "fastify 5.12.7", action: "npm i fastify@5.12.7" },
      {
        section: "act",
        headline: "nodemailer 10.1.4",
        action:
          "npm i nodemailer@10.1.4 (briff) · 9.x has no known fix, read the advisory: " +
          "garden.example, west.garden.example · transitive: mint-app, pantheon",
      },
      {
        section: "act",
        headline: "undici 7.30.1 / 6.23.0",
        action: "npm i undici@7.30.1 (tracker) · npm i undici@6.23.0 (budget)",
      },
    ]);
  });
});
