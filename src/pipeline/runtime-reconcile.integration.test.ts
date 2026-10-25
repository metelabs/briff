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
import { markdownToText } from "@/sources/post-body";

const sent = vi.hoisted(() => [] as { to: string; subject: string; text: string }[]);
vi.mock("@/lib/email/mailer", () => ({
  smtpConfig: () => ({ host: "h", port: 587, user: "u", pass: "p", from: "f@example.com" }),
  sendMail: async (msg: MailMessage) => {
    sent.push({ to: msg.to, subject: msg.subject, text: msg.text });
    return { status: "sent", messageId: "m" };
  },
}));

const { sendRuntimeUrgent } = await import("./runtime-urgent");

const TITLE = "Wednesday, October 21, 2026 Security Releases";
const POST = markdownToText(
  readFileSync(
    new URL(
      "../sources/__fixtures__/nodejs-october-2026-security-releases.post.md",
      import.meta.url
    ),
    "utf-8"
  )
);

type Row = [version: string, normalized: string, source: string];

// Production state of 23 Oct 2026: the match of the Node.js security release covers 14
// repos and their "fix released" email went out; four included node repos whose runtime
// rows arrived after the first email were never added to it.
const COVERED: Record<string, Row[]> = {
  "bakery.example": [["18-alpine", "18", "Dockerfile"]],
  briff: [
    ["22-alpine", "22", "Dockerfile"],
    [">=22.12", "22.12", "package.json engines.node"],
  ],
  "briff-reader": [["22-alpine", "22", "Dockerfile"]],
  "clinic.example": [["22-slim", "22", "Dockerfile"]],
  "garden.example": [["22.17.0-alpine", "22.17.0", "Dockerfile"]],
  grove: [["22-alpine", "22", "Dockerfile"]],
  "grove-admin": [["22-alpine", "22", "Dockerfile"]],
  "office-ledger": [["22-alpine", "22", "Dockerfile"]],
  "orchid-hotel": [["22.17.0-alpine", "22.17.0", "Dockerfile"]],
  "orchid-hotel.example": [["v14.15.0", "14.15.0", ".nvmrc"]],
  "pixel-studio": [["22.17.0-alpine", "22.17.0", "Dockerfile"]],
  "sigma/budget": [["24-slim", "24", "Dockerfile"]],
  "sigma/forms-web": [["24.15.0-alpine", "24.15.0", "Dockerfile"]],
  "sigma/mailer-v2": [["24.16.0-slim", "24.16.0", "Dockerfile"]],
};
const LATE: Record<string, Row[]> = {
  "sigma/pantheon": [
    ["24.16.0-slim", "24.16.0", "Dockerfile"],
    ["24.x", "24", "package.json engines.node"],
  ],
  "sigma/tracker": [["22-bookworm-slim", "22", "Dockerfile"]],
  "west.garden.example": [["22-alpine", "22", "Dockerfile"]],
  yard: [["22-alpine", "22", "Dockerfile"]],
};

// Runs only when TEST_DATABASE_URL points at a migrated, disposable database.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("runtime match reconciliation against Postgres", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  const saved = { ...process.env };
  const email = `rt-recon-${suffix}@example.com`;
  const userId = `rt-recon-u-${suffix}`;
  const now = new Date();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
  let orgId = "";
  let sourceId = "";
  let itemId = "";
  const ids = new Map<string, string>();
  const mine = () => sent.filter((m) => m.to === email);

  const addRepo = async (name: string, included: boolean, rows: Row[]) => {
    const scoped = withOrg(db, orgId);
    const repo = await scoped.repo.create({
      data: { orgId, name, source: "local", included },
    });
    ids.set(name, repo.id);
    for (const [version, normalized, source] of rows) {
      await scoped.repoRuntime.create({
        data: {
          orgId,
          repoId: repo.id,
          name: "node",
          version,
          normalized,
          source,
          ...(source === "Dockerfile" ? { image: "node" } : {}),
        },
      });
    }
  };

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: url,
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "https://app.example.com/",
      NODE_ENV: "test",
    });
    resetEnvCache();
    orgId = (await db.org.create({ data: { name: `rt-recon-${suffix}` } })).id;
    await db.user.create({ data: { id: userId, name: "u", email } });
    await db.orgMember.create({ data: { orgId, userId } });
    for (const [name, rows] of Object.entries(COVERED)) await addRepo(name, true, rows);
    for (const [name, rows] of Object.entries(LATE)) await addRepo(name, true, rows);
    // Outside every stream: never added, never emailed.
    await addRepo("sigma/pantheon-dashboard", false, [["22-alpine", "22", "Dockerfile"]]);

    sourceId = (
      await db.source.create({
        data: {
          kind: "rss",
          url: `https://example.com/node-recon-${suffix}.xml`,
          name: "Node.js vulnerability blog",
          runtime: "node",
          class: "security",
          enabled: false,
        },
      })
    ).id;
    const metadata = {
      ...runtimeMetaFromText(TITLE, POST),
      fixAddedAt: hoursAgo(4).toISOString(),
    };
    itemId = (
      await db.item.create({
        data: {
          sourceId,
          title: TITLE,
          url: `https://nodejs.org/en/blog/vulnerability/october-2026-recon-${suffix}`,
          contentHash: `rt-recon-${suffix}`,
          publishedAt: hoursAgo(40),
          rawText: POST,
          metadata: metadata as Prisma.InputJsonValue,
        },
      })
    ).id;
    await db.itemTriage.create({
      data: {
        itemId,
        bucket: "security",
        reason: "runtime-security",
        model: "rule",
        promptVersion: "rule-v1",
      },
    });
    const covered = Object.keys(COVERED).map((name) => ids.get(name) as string);
    await withOrg(db, orgId).itemMatch.create({
      data: {
        orgId,
        itemId,
        repoIds: covered,
        reason: "runtime:node",
        score: 1,
        urgentAt: hoursAgo(12),
        urgentRepoIds: covered,
        fixNotifiedAt: hoursAgo(3),
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

  it("adds the four late repos and sends one fix-form follow-up that lists only them", async () => {
    expect(await reconcileRuntimeMatches(db, orgId, now)).toEqual({ created: 0, updated: 1 });
    const repoIds = (await match()).repoIds as string[];
    expect(repoIds).toHaveLength(18);
    expect(repoIds.slice(0, 14)).toEqual(Object.keys(COVERED).map((n) => ids.get(n)));
    expect(repoIds).not.toContain(ids.get("sigma/pantheon-dashboard"));

    const counts = await sendRuntimeUrgent(db, log, now, async () => {}, { orgIds: [orgId] });
    expect(counts).toMatchObject({ runtimeUrgentEmails: 1, runtimeUrgentFollowUps: 1 });
    expect(mine()).toHaveLength(1);
    const [mail] = mine();
    expect(mail.subject).toBe(`Briff · urgent · also affects 4 more repos: ${TITLE}`);
    expect(mail.text).toContain(
      "Also affects sigma/pantheon, sigma/tracker, west.garden.example, yard (added after the alert of"
    );
    expect(mail.text).toContain("The fixed Node.js releases are out: 22.23.4, 24.22.1, 26.12.1.");
    for (const line of [
      "To do: sigma/pantheon: move Dockerfile to node:24.22.1-slim",
      "To do: sigma/tracker: rebuild to pick up Node.js 22.23.4; the node:22-bookworm-slim tag already points to it",
      "To do: west.garden.example: rebuild to pick up Node.js 22.23.4; the node:22-alpine tag already points to it",
      "To do: yard: rebuild to pick up Node.js 22.23.4; the node:22-alpine tag already points to it",
    ]) {
      expect(mail.text).toContain(line);
    }
    for (const name of [...Object.keys(COVERED), "sigma/pantheon-dashboard"]) {
      // Line starts only: "west.garden.example" contains "garden.example".
      expect(mail.text).not.toContain(`\n  ${name} runs node`);
      expect(mail.text).not.toContain(`To do: ${name}:`);
    }
    expect(((await match()).urgentRepoIds as string[]).sort()).toEqual([...repoIds].sort());
  });

  it("writes and sends nothing when run again", async () => {
    expect(await reconcileRuntimeMatches(db, orgId, now)).toEqual({ created: 0, updated: 0 });
    await sendRuntimeUrgent(db, log, now, async () => {}, { orgIds: [orgId] });
    expect(mine()).toHaveLength(1);
  });

  it("adds a repo included later on the next run, and never removes one", async () => {
    const dashboard = ids.get("sigma/pantheon-dashboard") as string;
    await withOrg(db, orgId).repo.update({ where: { id: dashboard }, data: { included: true } });
    // A covered repo stops declaring node: it stays on the match.
    await withOrg(db, orgId).repoRuntime.deleteMany({ where: { repoId: ids.get("grove") } });
    expect(await reconcileRuntimeMatches(db, orgId, now)).toEqual({ created: 0, updated: 1 });
    const repoIds = (await match()).repoIds as string[];
    expect(repoIds).toHaveLength(19);
    expect(repoIds).toContain(ids.get("grove"));
    await sendRuntimeUrgent(db, log, now, async () => {}, { orgIds: [orgId] });
    expect(mine()).toHaveLength(2);
    expect(mine()[1].subject).toBe(`Briff · urgent · also affects 1 more repo: ${TITLE}`);
    expect(mine()[1].text).toContain(
      "To do: sigma/pantheon-dashboard: rebuild to pick up Node.js 22.23.4"
    );
  });

  it("leaves items past both windows alone", async () => {
    const later = new Date(now.getTime() + 80 * 3_600_000);
    await addRepo("late-after-window", true, [["22-alpine", "22", "Dockerfile"]]);
    expect(await reconcileRuntimeMatches(db, orgId, later)).toEqual({ created: 0, updated: 0 });
  });
});
