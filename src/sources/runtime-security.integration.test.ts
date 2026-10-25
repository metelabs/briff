import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { resetEnvCache } from "@/lib/env";
import type { MailMessage } from "@/lib/email/mailer";
import { log } from "@/lib/log";
import type { FeedFetchResult } from "@/lib/rss/fetcher";
import type { SourceFetchOutcome, SourceToFetch } from "@/sources/fetch-source";

// PHP2Shell replay (CVE-2026-109618/109619): the php.net pre-announcement
// (20 Oct 2026 20:32 UTC), then the release posts and the php/php-src GitHub
// advisories (21 Oct). Fetches and SMTP are stubbed; the DB is real.

const PHP_FEED = "https://www.php.net/feed.atom";
const PHP_ADVISORIES = "https://api.github.com/repos/php/php-src/security-advisories";
const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");

const state = vi.hoisted(() => ({ feed: "", advisories: "[]" }));
const sent = vi.hoisted(() => [] as { to: string; subject: string; text: string }[]);

vi.mock("@/lib/rss/fetcher", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rss/fetcher")>();
  const { parseRss } = await import("@/lib/rss/parser");
  return {
    ...actual,
    fetchRssFeed: async (): Promise<FeedFetchResult> => ({
      status: "ok",
      parsed: parseRss(state.feed),
      etag: null,
      lastModified: null,
      httpStatus: 200,
    }),
  };
});
// Only the two PHP sources are fetched (feed parser and advisory adapter run for real);
// every other source in the shared test DB answers 304.
vi.mock("@/sources/fetch-source", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/sources/fetch-source")>();
  return {
    ...actual,
    fetchSource: async (source: SourceToFetch): Promise<SourceFetchOutcome> =>
      source.url === PHP_FEED || source.url === PHP_ADVISORIES
        ? actual.fetchSource(source)
        : { status: "not_modified", httpStatus: 304 },
  };
});
// Job tests share the database and claim any pending job; this test enqueues none.
vi.mock("@/lib/jobs/queue", () => ({
  enqueueJob: async () => ({ id: "job", created: false }),
}));
vi.mock("@/lib/email/mailer", () => ({
  smtpConfig: () => ({ host: "h", port: 587, user: "u", pass: "p", from: "f@example.com" }),
  sendMail: async (msg: MailMessage) => {
    sent.push({ to: msg.to, subject: msg.subject, text: msg.text });
    return { status: "sent", messageId: "m" };
  },
}));

const { collectSources } = await import("./collect");
const { prepareStream } = await import("@/pipeline/weekly");
const { assembleBulletin, isoWeekLabel, weekStartOf } = await import("@/pipeline/bulletin");

// Runs only when TEST_DATABASE_URL points at a migrated, disposable database.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("runtime security sources: PHP2Shell replay", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  const saved = { ...process.env };
  const email = `php2shell-${suffix}@example.com`;
  let orgId = "";
  let streamId = "";
  let repoId = "";

  const run = async (at: string) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(at));
    try {
      return await collectSources({
        db,
        log,
        jobId: "j",
        payload: { due: true },
        heartbeat: async () => {},
      });
    } finally {
      vi.useRealTimers();
    }
  };
  const mine = () => sent.filter((m) => m.to === email);
  const removePhpItems = () =>
    db.item.deleteMany({ where: { source: { url: { in: [PHP_FEED, PHP_ADVISORIES] } } } });

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: url,
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "https://app.example.com/",
      NODE_ENV: "test",
    });
    delete process.env.GITHUB_TOKEN;
    resetEnvCache();
    // Items are global and deduplicated by content: a previous run's items would not be "new".
    await removePhpItems();
    vi.stubGlobal("fetch", async (input: string) => {
      if (!String(input).startsWith(PHP_ADVISORIES)) throw new Error(`unexpected fetch ${input}`);
      return new Response(state.advisories, { status: 200 });
    });

    orgId = (await db.org.create({ data: { name: `php2shell-${suffix}` } })).id;
    const user = await db.user.create({ data: { id: `php-u-${suffix}`, name: "u", email } });
    await db.orgMember.create({ data: { orgId, userId: user.id } });
    const scoped = withOrg(db, orgId);
    repoId = (
      await scoped.repo.create({
        data: { orgId, name: "garden.example", source: "local", included: true },
      })
    ).id;
    await scoped.repoRuntime.create({
      data: {
        orgId,
        repoId,
        name: "php",
        version: "8.3-fpm",
        normalized: "8.3",
        source: "Dockerfile",
      },
    });
    streamId = (
      await scoped.bulletinStream.create({ data: { orgId, name: "Work", slug: `work-${suffix}` } })
    ).id;
    await scoped.streamRepo.create({ data: { orgId, streamId, repoId } });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await db.org.deleteMany({ where: { id: orgId } });
    await db.user.deleteMany({ where: { email } });
    await removePhpItems();
    await db.$disconnect();
    process.env = saved;
    resetEnvCache();
  });

  it("emails the pre-announcement within the hour, without the LLM", async () => {
    state.feed = fixture("php-news-preannounce.atom");
    state.advisories = "[]";
    const result = await run("2026-10-20T21:00:00Z");
    expect(result.counts?.ruleSecurity).toBe(1);

    expect(mine()).toHaveLength(1);
    const [first] = mine();
    expect(first.subject).toBe("Briff · urgent: Upcoming Critical PHP Security Release");
    expect(first.text).toContain("PHP announced a security release for 21 Oct 2026, 14:00 UTC.");
    expect(first.text).toContain("garden.example runs php 8.3 (Dockerfile).");
    expect(first.text).toContain(
      "To do: Update PHP in garden.example as soon as the fixed release is out (announced for 21 Oct 2026, 14:00 UTC)."
    );
    expect(first.text).toContain("Source: https://www.php.net/index.php#2026-10-20-1");

    const triage = await db.itemTriage.findFirst({
      where: { item: { source: { url: PHP_FEED } } },
      select: { bucket: true, reason: true, model: true },
    });
    expect(triage).toEqual({ bucket: "security", reason: "runtime-security", model: "rule" });
  });

  it("emails the fix with the action for the repo's line, skipping other lines and moderate advisories", async () => {
    state.feed = fixture("php-news.atom");
    state.advisories = fixture("github-advisories-php.json");
    await run("2026-10-21T14:00:00Z");

    expect(mine()).toHaveLength(2);
    const second = mine()[1];
    // One incident, one block: headed by php.net's advisory post, every item a source.
    expect(second.subject).toBe(
      "Briff · urgent: Security advisory: Critical remote code execution vulnerabilities, update now"
    );
    const text = second.text;
    expect(text.match(/^\* \[Security\]/gm)).toHaveLength(1);
    expect(text).toContain("CRITICAL · CVE-2026-109618 · CVE-2026-109619");
    expect(text).toContain("garden.example runs php 8.3 (Dockerfile).");
    expect(text).toContain("Fixed in: 8.5.12, 8.4.27, 8.3.36, 8.2.35");
    expect(text.match(/To do: /g)).toEqual(["To do: "]);
    expect(text).toContain(
      "To do: garden.example: rebuild to pick up PHP 8.3.36; the php:8.3-fpm tag already points to it"
    );
    expect(text).toContain(
      "Sources: Security advisory: Critical remote code execution vulnerabilities, update now <https://www.php.net/index.php#2026-10-21-5> · PHP 8.3.36 Released! <https://www.php.net/index.php#2026-10-21-2> · GHSA-6wmf-4rv5-p3rp <https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp> · GHSA-w8hw-w9fx-j79w <https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w>"
    );
    // Other release lines and the moderate September advisory are not emailed.
    expect(text).not.toContain("PHP 8.4.27 Released!");
    expect(text).not.toContain("GHSA-7875-c8px-7q5f");
    expect(text).not.toContain("Not affected");
  });

  it("sends nothing twice", async () => {
    await run("2026-10-21T15:00:00Z");
    expect(mine()).toHaveLength(2);
  });

  it("lists one act item in the weekly bulletin with the derived action", async () => {
    const now = new Date();
    const prepared = await prepareStream(
      db,
      orgId,
      { id: streamId, name: "Work", repoIds: [repoId] },
      {
        now,
        weekStart: weekStartOf(now),
        week: isoWeekLabel(now),
        language: "en",
        model: "fake",
        promptVersion: "synthesis-v6",
      }
    );
    expect(prepared).not.toBeNull();
    const selected = prepared?.selected ?? [];
    const mustAct = selected.filter((c) => c.mustAct);
    // The same headline as the urgent email.
    expect(mustAct.map((c) => c.title)).toEqual([
      "Security advisory: Critical remote code execution vulnerabilities, update now",
    ]);
    const assembled = assembleBulletin({ summary: "", act: [], know: [] }, selected);
    const act = assembled.items.filter((i) => i.section === "act");
    expect(act).toHaveLength(1);
    expect(act[0].action).toBe(
      "garden.example: rebuild to pick up PHP 8.3.36; the php:8.3-fpm tag already points to it"
    );
    expect(act[0].affectedRepos).toEqual(["garden.example"]);
    // The pre-announcement, the advisory post, the release posts and the second
    // advisory are folded under it as related.
    expect(act[0].foldedItemIds).toHaveLength(selected.length - 1);
    expect(assembled.items).toHaveLength(1);
  });

  it("reconciles on the hourly run: a repo that declares PHP later gets one follow-up", async () => {
    const scoped = withOrg(db, orgId);
    const late = await scoped.repo.create({
      data: { orgId, name: "pixel-studio", source: "local", included: true },
    });
    await scoped.repoRuntime.create({
      data: {
        orgId,
        repoId: late.id,
        name: "php",
        version: "8.3.30",
        normalized: "8.3.30",
        source: ".tool-versions",
      },
    });
    const result = await run("2026-10-21T16:00:00Z");
    expect(result.counts?.rematchUpdated).toBeGreaterThanOrEqual(1);
    expect(mine()).toHaveLength(3);
    const followUp = mine()[2];
    expect(followUp.subject).toMatch(/^Briff · urgent · also affects 1 more repo: /);
    expect(followUp.text).toContain("pixel-studio runs php 8.3.30 (.tool-versions).");
    expect(followUp.text).toContain("To do: pixel-studio: set php 8.3.36 in .tool-versions");
    expect(followUp.text).not.toContain("garden.example runs php");

    await run("2026-10-21T17:00:00Z");
    expect(mine()).toHaveLength(3);
  });
});
