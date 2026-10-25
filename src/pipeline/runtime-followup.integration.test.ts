import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { resetEnvCache } from "@/lib/env";
import type { MailMessage } from "@/lib/email/mailer";
import { log } from "@/lib/log";
import { reconcileRuntimeMatches } from "@/lib/match/rematch";
import { runtimeMetaFromText } from "@/lib/runtime-security";
import { ingestScan } from "@/lib/scan/ingest";
import type { ScanRepo } from "@/lib/scan/schema";
import { refreshOpenAnnouncements } from "@/sources/announcement-reconcile";
import { markdownToText } from "@/sources/post-body";

const sent = vi.hoisted(() => [] as { to: string; subject: string; text: string }[]);
// A slow SMTP send keeps a pass running while a second one starts.
const smtpDelay = vi.hoisted(() => ({ ms: 0 }));
vi.mock("@/lib/email/mailer", () => ({
  smtpConfig: () => ({ host: "h", port: 587, user: "u", pass: "p", from: "f@example.com" }),
  sendMail: async (msg: MailMessage) => {
    if (smtpDelay.ms > 0) await new Promise((resolve) => setTimeout(resolve, smtpDelay.ms));
    sent.push({ to: msg.to, subject: msg.subject, text: msg.text });
    return { status: "sent", messageId: "m" };
  },
}));

const { sendRuntimeUrgent } = await import("./runtime-urgent");

const post = (variant: "pre" | "post") =>
  markdownToText(
    readFileSync(
      new URL(
        `../sources/__fixtures__/nodejs-october-2026-security-releases.${variant}.md`,
        import.meta.url
      ),
      "utf-8"
    )
  );
const TITLE = "Wednesday, October 21, 2026 Security Releases";

// Runs only when TEST_DATABASE_URL points at a migrated, disposable database.
const url = process.env.TEST_DATABASE_URL;

// The 23 Oct 2026 incident: a scan uploaded in chunks, the urgent email went out after the
// first chunk, and the repos of the later chunks were never emailed.
describe.skipIf(!url)("runtime urgent follow-ups against Postgres", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  const saved = { ...process.env };
  const email = `rt-follow-${suffix}@example.com`;
  const userId = `rt-follow-u-${suffix}`;
  let orgId = "";
  let sourceId = "";
  let itemId = "";
  const mine = () => sent.filter((m) => m.to === email);

  const node = (name: string, version: string, normalized: string, source: string): ScanRepo => ({
    name,
    ecosystem: "npm",
    dependencies: [],
    runtimes: [
      {
        name: "node",
        version,
        normalized,
        source,
        ...(source === "Dockerfile" ? { image: "node" } : {}),
      },
    ],
  });
  const firstChunk = [
    node("grove", "22-alpine", "22", "Dockerfile"),
    node("forms-web", "22.17.0-alpine", "22.17.0", "Dockerfile"),
    node("briff", ">=20.9.0", "20.9.0", "package.json engines.node"),
    node("bakery.example", "18-alpine", "18", "Dockerfile"),
    node("pantheon", "24.16.0", "24.16.0", ".nvmrc"),
    node("mailer-v2", "24.16.0", "24.16.0", ".nvmrc"),
    node("budget", "24", "24", "Dockerfile"),
  ];
  const laterChunk = [
    node("orchid-hotel", "22-alpine", "22", "Dockerfile"),
    node("pixel-studio", "22-alpine", "22", "Dockerfile"),
    node("yard", "22", "22", ".nvmrc"),
    node("west.garden.example", "22-alpine", "22", "Dockerfile"),
    node("office-ledger", "22-alpine", "22", "Dockerfile"),
  ];

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: url,
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "https://app.example.com/",
      NODE_ENV: "test",
    });
    resetEnvCache();
    orgId = (await db.org.create({ data: { name: `rt-follow-${suffix}` } })).id;
    await db.user.create({ data: { id: userId, name: "u", email } });
    await db.orgMember.create({ data: { orgId, userId } });
    // Every repo is already in a stream; the scan only brings their runtimes.
    for (const r of [...firstChunk, ...laterChunk]) {
      await withOrg(db, orgId).repo.create({
        data: { orgId, name: r.name, source: "local", included: true },
      });
    }
    sourceId = (
      await db.source.create({
        data: {
          kind: "rss",
          url: `https://example.com/node-vuln-${suffix}.xml`,
          name: "Node.js vulnerability blog",
          runtime: "node",
          class: "security",
          // Not fetched by collect-sources runs of other test files.
          enabled: false,
        },
      })
    ).id;
    const item = await db.item.create({
      data: {
        sourceId,
        title: TITLE,
        url: `https://nodejs.org/en/blog/vulnerability/october-2026-${suffix}`,
        contentHash: `rt-follow-${suffix}`,
        publishedAt: new Date(Date.now() - 3_600_000),
        rawText: post("pre"),
        metadata: runtimeMetaFromText(TITLE, post("pre")) as Prisma.InputJsonValue,
      },
    });
    itemId = item.id;
    await db.itemTriage.create({
      data: {
        itemId,
        bucket: "security",
        reason: "runtime-security",
        model: "rule",
        promptVersion: "rule-v1",
      },
    });
  });

  afterAll(async () => {
    await db.org.deleteMany({ where: { id: orgId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.source.deleteMany({ where: { id: sourceId } });
    await db.$disconnect();
    process.env = saved;
    resetEnvCache();
  });

  const match = () => withOrg(db, orgId).itemMatch.findFirstOrThrow({ where: { itemId } });

  it("emails the first chunk's seven repos", async () => {
    await ingestScan(db, orgId, { source: "local", repos: firstChunk });
    await reconcileRuntimeMatches(db, orgId);
    await sendRuntimeUrgent(db, log, new Date());
    expect(mine()).toHaveLength(1);
    const [first] = mine();
    expect(first.subject).toBe(`Briff · urgent: ${TITLE}`);
    for (const r of firstChunk) expect(first.text).toContain(`${r.name} runs node`);
    expect(first.text).toContain(
      "bakery.example: node 18 is end-of-life and will not get this fix; move to 22 or later"
    );
    expect(first.text).not.toContain("orchid-hotel");
    expect((await match()).urgentRepoIds).toHaveLength(7);
  });

  it("sends one follow-up that lists exactly the five repos a later chunk added", async () => {
    await ingestScan(db, orgId, { source: "local", repos: laterChunk });
    expect((await reconcileRuntimeMatches(db, orgId)).updated).toBe(1);
    await sendRuntimeUrgent(db, log, new Date());
    expect(mine()).toHaveLength(2);
    const second = mine()[1];
    expect(second.subject).toBe(`Briff · urgent · also affects 5 more repos: ${TITLE}`);
    expect(second.text).toContain(
      "Also affects office-ledger, orchid-hotel, pixel-studio, west.garden.example, yard"
    );
    for (const r of laterChunk) expect(second.text).toContain(`${r.name} runs node`);
    for (const r of firstChunk) expect(second.text).not.toContain(`${r.name} runs node`);
    expect((await match()).urgentRepoIds).toHaveLength(12);

    await sendRuntimeUrgent(db, log, new Date());
    expect(mine()).toHaveLength(2);
  });

  it("sends the fix follow-up once the post is updated in place, with one action per repo", async () => {
    const refreshed = await refreshOpenAnnouncements(db, sourceId, new Date(), async (bodyUrl) => {
      expect(bodyUrl).toBe(
        `https://raw.githubusercontent.com/nodejs/nodejs.org/main/apps/site/pages/en/blog/vulnerability/october-2026-${suffix}.md`
      );
      return post("post");
    });
    expect(refreshed).toMatchObject({ updated: 1, fixReleased: 1, bodyFetches: 1 });
    const item = await db.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.contentHash).toBe(`rt-follow-${suffix}`);
    expect(item.rawText).toContain("Node.js v22.23.4");

    await sendRuntimeUrgent(db, log, new Date());
    expect(mine()).toHaveLength(3);
    const fix = mine()[2];
    expect(fix.subject).toBe(`Briff · urgent · fix released: ${TITLE}`);
    expect(fix.text).toContain("The fixed Node.js releases are out: 22.23.4, 24.22.1, 26.12.1.");
    for (const line of [
      "To do: grove: rebuild to pick up Node.js 22.23.4; the node:22-alpine tag already points to it",
      "To do: forms-web: move Dockerfile to node:22.23.4-alpine",
      "To do: briff: run node 22.23.4 or later (package.json engines.node allows >=20.9.0)",
      "To do: bakery.example: node 18 is end-of-life and will not get this fix; move to 22.23.4 or later",
      "To do: pantheon: set node 24.22.1 in .nvmrc",
      "To do: yard: set node 22.23.4 in .nvmrc",
    ]) {
      expect(fix.text).toContain(line);
    }
    expect((await match()).fixNotifiedAt).not.toBeNull();

    // The post changes again (credits): no further email, and the open item is no longer re-read.
    expect(
      await refreshOpenAnnouncements(db, sourceId, new Date(), async () => `${post("post")}\nx`)
    ).toMatchObject({ bodyFetches: 0 });
    await sendRuntimeUrgent(db, log, new Date());
    expect(mine()).toHaveLength(3);
  });

  it("sends once when two passes run at the same time, and keeps a scoped pass to its org", async () => {
    const pre = post("pre").replace("October 21, 2026", "October 22, 2026");
    const other = await db.item.create({
      data: {
        sourceId,
        title: `${TITLE} (second)`,
        url: `https://nodejs.org/en/blog/vulnerability/second-${suffix}`,
        contentHash: `rt-follow-second-${suffix}`,
        publishedAt: new Date(Date.now() - 3_600_000),
        rawText: pre,
        metadata: runtimeMetaFromText(TITLE, pre) as Prisma.InputJsonValue,
      },
    });
    await db.itemTriage.create({
      data: {
        itemId: other.id,
        bucket: "security",
        reason: "runtime-security",
        model: "rule",
        promptVersion: "rule-v1",
      },
    });
    await reconcileRuntimeMatches(db, orgId);

    // Scoped to another org: this org's pending match is left alone.
    const elsewhere = await sendRuntimeUrgent(db, log, new Date(), async () => {}, {
      orgIds: [`missing-${suffix}`],
    });
    expect(elsewhere.runtimeUrgentEmails).toBe(0);
    expect(mine()).toHaveLength(3);

    smtpDelay.ms = 400;
    try {
      const passes = await Promise.all([
        sendRuntimeUrgent(db, log, new Date(), async () => {}, { orgIds: [orgId] }),
        new Promise((resolve) => setTimeout(resolve, 100)).then(() =>
          sendRuntimeUrgent(db, log, new Date(), async () => {}, { orgIds: [orgId] })
        ),
      ]);
      expect(passes.map((p) => p.runtimeUrgentLocked).sort()).toEqual([0, 1]);
    } finally {
      smtpDelay.ms = 0;
    }
    expect(mine()).toHaveLength(4);
    expect(mine()[3].subject).toBe(`Briff · urgent: ${TITLE} (second)`);
    expect(
      (await withOrg(db, orgId).itemMatch.findFirstOrThrow({ where: { itemId: other.id } }))
        .urgentAt
    ).not.toBeNull();
  });
});
