import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { resetEnvCache } from "@/lib/env";
import { log } from "@/lib/log";
import type { JsonRequest, LlmClient } from "@/llm/client";
import { createFakeLlm } from "@/llm/fake";

import { bulletinPreview } from "./preview";
import { refreshProfile } from "./profile";
import { triageRequest } from "./triage";

// Every LLM request the pipeline sends for one org, scanned for what must never leave:
// repo names, the org name, member emails and names, scan token secrets and hashes.
const sent: JsonRequest<unknown>[] = [];

function capturing(): LlmClient {
  const fake = createFakeLlm();
  return {
    kind: "fake",
    json: (req) => {
      sent.push(req as JsonRequest<unknown>);
      return fake.json(req);
    },
    jsonBatch: (reqs, options) => {
      sent.push(...(reqs as JsonRequest<unknown>[]));
      return fake.jsonBatch(reqs, options);
    },
  };
}

vi.mock("@/llm/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/llm/client")>();
  return { ...original, getLlm: () => ({ ok: true, client: capturing(), batch: false }) };
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("LLM payloads against Postgres", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  const saved = { ...process.env };
  const secret = {
    org: `Hushhush Holdings ${suffix}`,
    email: `owner-${suffix}@hushhush.example`,
    userName: `Ozymandias ${suffix}`,
    token: `brf_${"s".repeat(30)}${suffix}`.slice(0, 44),
    tokenHash: `hash${suffix}`.padEnd(64, "0"),
    repos: [`hushhush/billing-core-${suffix}`, `ledger-web-${suffix}`],
    // In the org but in no stream; the org-wide profile names it.
    outside: `hushhush/vault-${suffix}`,
  };
  let orgId = "";
  let streamId = "";
  let userId = "";
  let sourceId = "";
  let itemId = "";
  let packageId = "";
  let actionPackageId = "";

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: url,
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "http://127.0.0.1:3000",
      BRIFF_LLM_FAKE: "true",
      NODE_ENV: "test",
    });
    resetEnvCache();
    userId = (
      await db.user.create({
        data: { id: `u-${suffix}`, name: secret.userName, email: secret.email },
      })
    ).id;
    orgId = (await db.org.create({ data: { name: secret.org } })).id;
    const scoped = withOrg(db, orgId);
    await scoped.orgMember.create({ data: { orgId, userId } });
    await scoped.scanToken.create({
      data: {
        orgId,
        name: "ci",
        tokenHash: secret.tokenHash,
        prefix: secret.token.slice(0, 8),
        createdByUserId: userId,
      },
    });
    const stream = await scoped.bulletinStream.create({
      data: { orgId, name: "Work", slug: `work-${suffix}` },
    });
    streamId = stream.id;
    packageId = (
      await db.package.upsert({
        where: { ecosystem_name: { ecosystem: "npm", name: `hush-pkg-${suffix}` } },
        create: { ecosystem: "npm", name: `hush-pkg-${suffix}` },
        update: {},
      })
    ).id;
    const repoIds: string[] = [];
    for (const name of secret.repos) {
      const repo = await scoped.repo.create({
        data: { orgId, name, source: "github", included: true },
      });
      repoIds.push(repo.id);
      await scoped.streamRepo.create({ data: { orgId, streamId, repoId: repo.id } });
      await scoped.dependency.create({
        data: { orgId, repoId: repo.id, packageId, installedVersion: "1.0.0", direct: true },
      });
    }
    actionPackageId = (
      await db.package.create({
        data: { ecosystem: "GitHub Actions", name: secret.outside },
      })
    ).id;
    await scoped.dependency.create({
      data: {
        orgId,
        repoId: repoIds[0],
        packageId: actionPackageId,
        installedVersion: "main",
        direct: true,
      },
    });
    await scoped.repo.create({
      data: { orgId, name: secret.outside, source: "github", included: false },
    });
    sourceId = (
      await db.source.create({
        data: {
          kind: "github_releases",
          url: `https://github.com/hush/pkg-${suffix}/releases.atom`,
          name: `hush/pkg-${suffix} releases`,
        },
      })
    ).id;
    const item = await db.item.create({
      data: {
        sourceId,
        title: `hush-pkg-${suffix} 2.0.0`,
        url: `https://github.com/hush/pkg-${suffix}/releases/tag/v2.0.0`,
        rawText: "Breaking: drops the legacy API.",
        contentHash: `hash-${suffix}`,
        publishedAt: new Date(),
      },
    });
    itemId = item.id;
    await db.itemTriage.create({
      data: { itemId, bucket: "breaking_or_feature", model: "m", promptVersion: "p" },
    });
    await scoped.itemMatch.create({
      data: {
        orgId,
        itemId,
        packageId,
        repoIds,
        reason: `release:hush-pkg-${suffix}`,
        score: 0.9,
      },
    });
    await scoped.interestProfile.create({
      data: {
        orgId,
        text: `Cares most about billing-core-${suffix} and ledger-web-${suffix}, then https://github.com/${secret.outside}.`,
        weights: { [`package:hush-pkg-${suffix}`]: 1, [`package:${secret.outside}`]: 1 },
      },
    });
    await scoped.feedback.create({ data: { orgId, userId, itemId, kind: "up" } });
  });

  afterAll(async () => {
    await db.org.deleteMany({ where: { id: orgId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.source.deleteMany({ where: { id: sourceId } });
    await db.package.deleteMany({ where: { id: { in: [packageId, actionPackageId] } } });
    await db.$disconnect();
    process.env = saved;
    resetEnvCache();
  });

  function forbidden(): string[] {
    return [
      secret.org,
      secret.email,
      secret.userName,
      secret.token,
      secret.tokenHash,
      orgId,
      userId,
      ...secret.repos,
      ...secret.repos.map((r) => r.split("/").pop() ?? r),
      secret.outside,
      `vault-${suffix}`,
      "hushhush",
    ];
  }

  it("sends no repo name, org name, email or token in synthesis, profile or triage", async () => {
    sent.length = 0;
    const res = await bulletinPreview({
      db,
      log,
      jobId: "job",
      payload: { orgId, streamId, model: "claude-haiku-5-5" },
      heartbeat: async () => {},
    });
    expect(res.counts).toMatchObject({ generated: 1 });
    expect(
      await refreshProfile({
        db,
        llm: capturing(),
        model: "m",
        orgId,
        language: "en",
        meter: { add: () => {} } as never,
        log,
      })
    ).toBe("refreshed");
    sent.push(
      triageRequest(
        "m",
        [
          {
            id: itemId,
            title: `hush-pkg-${suffix} 2.0.0`,
            url: "https://example.com",
            rawText: "Breaking",
            publishedAt: new Date(),
            sourceName: `hush/pkg-${suffix} releases`,
            matchedVia: `release:hush-pkg-${suffix}`,
          },
        ],
        new Date()
      ) as JsonRequest<unknown>
    );
    expect(sent.map((r) => r.task).sort()).toEqual(["profile", "synthesis", "triage"]);

    for (const req of sent) {
      const payload = `${req.system}\n${req.user}`.toLowerCase();
      for (const value of forbidden()) expect(payload, req.task).not.toContain(value.toLowerCase());
    }
    // Package names and versions are the product and go as they are.
    const synthesis = sent.find((r) => r.task === "synthesis");
    expect(synthesis?.user).toContain(`hush-pkg-${suffix}@1.0.0`);
    expect(synthesis?.user).toMatch(/"affected_repos":\["repo-\d","repo-\d"\]/);

    // What comes back carries the real names again.
    const profile = await withOrg(db, orgId).interestProfile.findFirst({ select: { text: true } });
    expect(profile?.text).toBe(
      `Cares most about billing-core-${suffix} and ledger-web-${suffix}, then https://github.com/${secret.outside}.`
    );
    const stored = await withOrg(db, orgId).bulletinItem.findFirst({
      where: { itemId },
      select: { affectedRepos: true },
    });
    expect(stored?.affectedRepos).toEqual([...secret.repos].sort());
  });
});
