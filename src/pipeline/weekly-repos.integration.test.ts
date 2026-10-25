import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { resetEnvCache } from "@/lib/env";
import { log } from "@/lib/log";
import type { JsonRequest, LlmClient } from "@/llm/client";
import { createFakeLlm } from "@/llm/fake";

import { parseUpgrades, upgradeLine } from "./upgrades";

// W43 replay: the first production bulletin after repo-name pseudonymisation stored items
// whose `affectedRepos` and `upgrades` named different repos, and lines that named only
// some of the affected repos. The fixture holds the stored match repos, installed versions
// and alerted repos; the weekly job runs for real against Postgres with the fake LLM.

interface FixtureItem {
  key: string;
  title: string;
  text: string;
  bucket: "security" | "breaking_or_feature";
  package: string;
  reason: string;
  matchedRepos: string[];
  advisory?: { introduced: string; fixed: string };
  alertedRepos?: string[];
  /** Repos the model's line names (written as their aliases, like the real model). */
  modelLineNames?: string[];
}

interface Fixture {
  streams: Record<string, string[]>;
  dependencies: { repo: string; package: string; version: string; direct: boolean }[];
  items: FixtureItem[];
}

const fixture = JSON.parse(
  readFileSync(new URL("./__fixtures__/w43-repos.json", import.meta.url), "utf8")
) as Fixture;

interface SentItem {
  ref: number;
  title: string;
  affected_repos: string[];
}

type RawOutput = {
  act: { ref: number; line: string }[];
  know: { ref: number; line: string }[];
};

/**
 * The fake LLM, except that items with `modelLineNames` get a line naming only those repos,
 * by alias: the model never sees real names, so the rule has to hold after restoring.
 */
function partialLines(): LlmClient {
  const fake = createFakeLlm();
  const rewrite = <T>(req: JsonRequest<T>): JsonRequest<T> => {
    if (req.task !== "synthesis") return req;
    const sent = (JSON.parse(req.user) as { items: SentItem[] }).items;
    return {
      ...req,
      parse: (value) => {
        const out = value as RawOutput;
        for (const entry of [...out.act, ...out.know]) {
          const item = sent.find((i) => i.ref === entry.ref);
          const spec = fixture.items.find((f) => f.title === item?.title);
          if (!item || !spec?.modelLineNames) continue;
          // Aliases follow the order of the real names, and affected_repos is sorted.
          const real = [...spec.matchedRepos].sort();
          const named = spec.modelLineNames.map((r) => item.affected_repos[real.indexOf(r)]);
          entry.line = `${spec.package} drops an API used in ${named.join(", ")}.`;
        }
        return req.parse(out);
      },
    };
  };
  return {
    kind: "fake",
    json: (req) => fake.json(rewrite(req)),
    jsonBatch: (reqs, options) => fake.jsonBatch(reqs.map(rewrite), options),
  };
}

vi.mock("@/llm/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/llm/client")>();
  return { ...original, getLlm: () => ({ ok: true, client: partialLines(), batch: false }) };
});
vi.mock("@/lib/email/mailer", () => ({
  smtpConfig: () => null,
  sendMail: async () => ({ status: "skipped" }),
}));

const { weeklyBulletin } = await import("./weekly");

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("weekly bulletin: affected repos and upgrades agree (W43)", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  const saved = { ...process.env };
  let orgId = "";
  const sourceIds: string[] = [];
  const advisoryIds: string[] = [];

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: url,
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "http://127.0.0.1:3000",
      BRIFF_LLM_FAKE: "true",
      NODE_ENV: "test",
    });
    resetEnvCache();
    orgId = (await db.org.create({ data: { name: `w43-${suffix}` } })).id;
    const scoped = withOrg(db, orgId);
    const repoIds = new Map<string, string>();
    for (const [name, repos] of Object.entries(fixture.streams)) {
      const stream = await scoped.bulletinStream.create({
        data: { orgId, name, slug: `${name.toLowerCase()}-${suffix}` },
      });
      for (const repo of repos) {
        const id = (
          await scoped.repo.create({
            data: { orgId, name: repo, source: "github", included: true },
          })
        ).id;
        repoIds.set(repo, id);
        await scoped.streamRepo.create({ data: { orgId, streamId: stream.id, repoId: id } });
      }
    }
    const packageIds = new Map<string, string>();
    const packageId = async (name: string) => {
      const known = packageIds.get(name);
      if (known) return known;
      const id = (
        await db.package.upsert({
          where: { ecosystem_name: { ecosystem: "npm", name } },
          create: { ecosystem: "npm", name },
          update: {},
        })
      ).id;
      packageIds.set(name, id);
      return id;
    };
    for (const d of fixture.dependencies) {
      await scoped.dependency.create({
        data: {
          orgId,
          repoId: repoIds.get(d.repo) as string,
          packageId: await packageId(d.package),
          installedVersion: d.version,
          direct: d.direct,
        },
      });
    }
    const yesterday = new Date(Date.now() - 86_400_000);
    for (const f of fixture.items) {
      const source = await db.source.create({
        data: {
          kind: "github_releases",
          url: `https://github.com/w43-${suffix}/${f.key}/releases.atom`,
          name: `w43/${f.key} releases`,
        },
      });
      sourceIds.push(source.id);
      const item = await db.item.create({
        data: {
          sourceId: source.id,
          title: f.title,
          url: `https://github.com/w43-${suffix}/${f.key}/releases/tag/1`,
          rawText: f.text,
          contentHash: `w43-${f.key}-${suffix}`,
          publishedAt: yesterday,
        },
      });
      await db.itemTriage.create({
        data: {
          itemId: item.id,
          bucket: f.bucket,
          packages: [f.package],
          model: "m",
          promptVersion: "p",
        },
      });
      await scoped.itemMatch.create({
        data: {
          orgId,
          itemId: item.id,
          packageId: await packageId(f.reason.replace(/^release:/, "")),
          repoIds: f.matchedRepos.map((r) => repoIds.get(r) as string),
          reason: f.reason,
          score: 1,
        },
      });
      if (!f.advisory) continue;
      const advisory = await db.advisory.create({
        data: {
          osvId: `GHSA-w43-${f.key}-${suffix}`,
          packageId: await packageId(f.package),
          severity: "high",
          affected: [
            {
              type: "SEMVER",
              events: [{ introduced: f.advisory.introduced }, { fixed: f.advisory.fixed }],
            },
          ],
        },
      });
      advisoryIds.push(advisory.id);
      for (const repo of f.alertedRepos ?? []) {
        await scoped.alert.create({
          data: { orgId, advisoryId: advisory.id, repoId: repoIds.get(repo) as string },
        });
      }
    }

    await weeklyBulletin({ db, log, jobId: "w43", payload: {}, heartbeat: async () => {} });
  });

  afterAll(async () => {
    await db.org.deleteMany({ where: { id: orgId } });
    await db.advisory.deleteMany({ where: { id: { in: advisoryIds } } });
    await db.source.deleteMany({ where: { id: { in: sourceIds } } });
    await db.$disconnect();
    process.env = saved;
    resetEnvCache();
  });

  const stored = async (stream: string, title: string) => {
    const rows = await withOrg(db, orgId).bulletinItem.findMany({
      where: { bulletin: { stream: { name: stream }, preview: false }, item: { title } },
      select: { section: true, line: true, affectedRepos: true, upgrades: true },
    });
    expect(rows).toHaveLength(1);
    const [row] = rows;
    const upgrades = parseUpgrades(row.upgrades);
    return {
      ...row,
      affectedRepos: row.affectedRepos as string[],
      upgrades,
      upgradeRepos: [...new Set(upgrades.map((u) => u.repo))],
      lines: upgrades.map(upgradeLine),
    };
  };

  it("payload: the alerted repos join the match repos, and every one has an upgrade line", async () => {
    const item = await stored("Acme", "payloadcms/payload v3.92.0");
    expect(item.section).toBe("act");
    expect(item.affectedRepos).toEqual([
      "bakery.example",
      "clinic.example",
      "garden.example",
      "orchid-hotel",
      "pixel-studio",
      "west.garden.example",
    ]);
    expect(item.upgradeRepos).toEqual(item.affectedRepos);
    expect(item.lines).toEqual([
      "bakery.example: payload 2.32.3",
      "clinic.example: payload 3.86.0 → 3.92.0",
      "garden.example: payload 3.65.0",
      "orchid-hotel: payload 3.85.1 → 3.92.0",
      "pixel-studio: payload 3.85.0 → 3.92.0",
      "west.garden.example: payload 3.65.0",
    ]);
  });

  it("better-auth: the repo without an alert keeps its installed version", async () => {
    const item = await stored("Sigma", "better-auth/better-auth v1.7.12");
    expect(item.affectedRepos).toEqual(["sigma/budget", "sigma/forms-web"]);
    expect(item.upgradeRepos).toEqual(item.affectedRepos);
    expect(item.lines).toEqual([
      "sigma/budget: better-auth 1.4.9 → 1.7.12",
      "sigma/forms-web: better-auth 1.6.23",
    ]);
  });

  it("@hono/node-server: both streams list both affected repos", async () => {
    const acme = await stored("Acme", "honojs/node-server v1.19.15");
    expect(acme.affectedRepos).toEqual(["briff", "briff-reader"]);
    expect(acme.upgradeRepos).toEqual(acme.affectedRepos);
    expect(acme.lines).toEqual([
      "briff: @hono/node-server 2.1.5 (transitive)",
      "briff-reader: @hono/node-server 1.19.14 (transitive)",
    ]);
    const sigma = await stored("Sigma", "honojs/node-server v1.19.15");
    expect(sigma.affectedRepos).toEqual(["sigma/mailer-v2", "sigma/pantheon"]);
    expect(sigma.upgradeRepos).toEqual(sigma.affectedRepos);
    expect(sigma.lines).toEqual([
      "sigma/mailer-v2: @hono/node-server 1.19.11 → 1.19.15",
      "sigma/pantheon: @hono/node-server 2.0.12 (transitive)",
    ]);
  });

  it("a line that names some affected repos gets the others appended", async () => {
    const i18next = await stored("Acme", "i18next v26.0.0");
    expect(i18next.affectedRepos).toHaveLength(5);
    expect(i18next.line).toBe(
      "i18next drops an API used in briff, clinic.example, garden.example, west.garden.example. Also affects bakery.example."
    );
    const openai = await stored("Acme", "openai/openai-node v6.0.0");
    expect(openai.affectedRepos).toEqual(["briff", "briff-reader", "office-ledger"]);
    expect(openai.line).toBe(
      "openai drops an API used in briff-reader. Also affects briff, office-ledger."
    );
  });
});
