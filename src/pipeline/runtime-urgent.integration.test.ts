import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { resetEnvCache } from "@/lib/env";
import type { MailMessage } from "@/lib/email/mailer";
import { JobLockLostError } from "@/lib/jobs/queue";
import { log } from "@/lib/log";
import { reconcileRuntimeMatches } from "@/lib/match/rematch";
import type { RuntimeItemMeta } from "@/lib/runtime-security";
import { ingestScan } from "@/lib/scan/ingest";
import { reconcileAdvisories } from "@/sources/advisory-reconcile";
import { contentHash, type CollectedItem } from "@/sources/fetch-source";

const sent = vi.hoisted(() => [] as { to: string; subject: string; text: string }[]);
vi.mock("@/lib/email/mailer", () => ({
  smtpConfig: () => ({ host: "h", port: 587, user: "u", pass: "p", from: "f@example.com" }),
  sendMail: async (msg: MailMessage) => {
    sent.push({ to: msg.to, subject: msg.subject, text: msg.text });
    return { status: "sent", messageId: "m" };
  },
}));

const { sendRuntimeUrgent } = await import("./runtime-urgent");

// Runs only when TEST_DATABASE_URL points at a migrated, disposable database.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("runtime urgent delivery against Postgres", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  const saved = { ...process.env };
  const email = `rt-urgent-${suffix}@example.com`;
  const feedUrl = `https://example.com/php-${suffix}.atom`;
  const ghsaUrl = `https://api.github.com/repos/example-${suffix}/php/security-advisories`;
  let orgId = "";
  let sourceId = "";
  let ghsaSourceId = "";
  const userId = `rt-u-${suffix}`;
  const mine = () => sent.filter((m) => m.to === email);
  const hourAgo = () => new Date(Date.now() - 3_600_000);

  async function securityItem(source: string, title: string, meta: RuntimeItemMeta) {
    const item = await db.item.create({
      data: {
        sourceId: source,
        title,
        url: `https://example.com/${suffix}/${encodeURIComponent(title)}`,
        contentHash: `rt-${suffix}-${title}`,
        publishedAt: hourAgo(),
        metadata: meta as Prisma.InputJsonValue,
      },
    });
    await db.itemTriage.create({
      data: {
        itemId: item.id,
        bucket: "security",
        reason: "runtime-security",
        model: "rule",
        promptVersion: "rule-v1",
      },
    });
    return item.id;
  }
  const urgentAtOf = async (itemId: string) =>
    (await withOrg(db, orgId).itemMatch.findFirst({ where: { itemId } }))?.urgentAt ?? null;

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: url,
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "https://app.example.com/",
      NODE_ENV: "test",
    });
    resetEnvCache();
    orgId = (await db.org.create({ data: { name: `rt-${suffix}` } })).id;
    await db.user.create({ data: { id: userId, name: "u", email } });
    await withOrg(db, orgId).repo.create({
      data: { orgId, name: "garden.example", source: "local", included: true },
    });
    sourceId = (
      await db.source.create({
        data: { kind: "rss", url: feedUrl, name: "PHP news", runtime: "php", class: "security" },
      })
    ).id;
    ghsaSourceId = (
      await db.source.create({
        data: {
          kind: "github_advisories",
          url: ghsaUrl,
          name: "php advisories",
          runtime: "php",
          class: "security",
        },
      })
    ).id;
  });

  afterAll(async () => {
    await db.org.deleteMany({ where: { id: orgId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.source.deleteMany({ where: { id: { in: [sourceId, ghsaSourceId] } } });
    await db.$disconnect();
    process.env = saved;
    resetEnvCache();
  });

  const critical: RuntimeItemMeta = {
    kind: "announcement",
    cveIds: ["CVE-2026-1"],
    severity: "critical",
    fixedVersions: ["8.3.36"],
  };

  it("matches an item collected before the repo declared the runtime once the scan adds it", async () => {
    const itemId = await securityItem(sourceId, "PHP 8.3.36 Released!", critical);
    expect(await reconcileRuntimeMatches(db, orgId)).toEqual({ created: 0, updated: 0 });

    const [ingested] = await ingestScan(db, orgId, {
      source: "local",
      repos: [
        {
          name: "garden.example",
          ecosystem: "npm",
          dependencies: [],
          runtimes: [
            {
              name: "php",
              version: "8.3-fpm",
              normalized: "8.3",
              source: "Dockerfile",
              image: "php",
            },
          ],
        },
      ],
    });
    expect(ingested.runtimesChanged).toBe(true);
    expect(await reconcileRuntimeMatches(db, orgId)).toEqual({ created: 1, updated: 0 });
    expect(await urgentAtOf(itemId)).toBeNull();
  });

  it("keeps the match pending while the org has no member, sends once one joins", async () => {
    const before = await sendRuntimeUrgent(db, log, new Date());
    expect(before.runtimeUrgentNoRecipients).toBeGreaterThanOrEqual(1);
    const [match] = await withOrg(db, orgId).itemMatch.findMany({ select: { urgentAt: true } });
    expect(match.urgentAt).toBeNull();

    await db.orgMember.create({ data: { orgId, userId } });
    await sendRuntimeUrgent(db, log, new Date());
    expect(mine()).toHaveLength(1);
    expect(mine()[0].text).toContain("garden.example runs php 8.3 (Dockerfile).");
    expect(mine()[0].text).toContain(
      "garden.example: rebuild to pick up PHP 8.3.36; the php:8.3-fpm tag already points to it"
    );
    await sendRuntimeUrgent(db, log, new Date());
    expect(mine()).toHaveLength(1);
  });

  it("heartbeats before every org and every send, and stops when the lock is lost", async () => {
    const itemId = await securityItem(sourceId, "PHP 8.3.37 Released!", {
      ...critical,
      fixedVersions: ["8.3.37"],
    });
    await reconcileRuntimeMatches(db, orgId);

    const lost = sendRuntimeUrgent(db, log, new Date(), async () => {
      throw new JobLockLostError("j");
    });
    await expect(lost).rejects.toBeInstanceOf(JobLockLostError);
    expect(await urgentAtOf(itemId)).toBeNull();
    expect(mine()).toHaveLength(1);

    let beats = 0;
    await sendRuntimeUrgent(db, log, new Date(), async () => {
      beats++;
    });
    // At least one per org (this one included) plus one before its send.
    expect(beats).toBeGreaterThanOrEqual(2);
    expect(mine()).toHaveLength(2);
    expect(await urgentAtOf(itemId)).not.toBeNull();
  });

  it("updates an edited advisory in place and reopens it when severity rises", async () => {
    const advisory = (summary: string, severity: string, fixed: string[], updatedAt: string) => {
      const title = `PHP security advisory: ${summary} (CVE-2026-9)`;
      const link = `https://github.com/example-${suffix}/php/security/advisories/GHSA-test`;
      return {
        guid: "GHSA-test",
        title,
        url: link,
        publishedAt: hourAgo(),
        rawText: summary,
        contentHash: contentHash(link, title),
        metadata: {
          kind: "advisory",
          ghsaId: "GHSA-test",
          updatedAt,
          cveIds: ["CVE-2026-9"],
          severity,
          fixedVersions: fixed,
        },
      } satisfies CollectedItem;
    };

    const first = advisory("Header parsing bug", "medium", [], "2026-10-21T10:00:00Z");
    const created = await reconcileAdvisories(db, ghsaSourceId, [first]);
    expect(created.fresh).toHaveLength(1);
    const itemId = await securityItem(ghsaSourceId, "x", first.metadata);
    await db.item.update({
      where: { id: itemId },
      data: {
        guid: first.guid,
        title: first.title,
        url: first.url,
        contentHash: first.contentHash,
      },
    });
    await reconcileRuntimeMatches(db, orgId);
    await sendRuntimeUrgent(db, log, new Date());
    // Medium: handled without an email.
    expect(await urgentAtOf(itemId)).not.toBeNull();
    expect(mine()).toHaveLength(2);

    const edited = advisory(
      "RCE in header parsing",
      "critical",
      ["8.3.38"],
      "2026-10-21T12:00:00Z"
    );
    expect(await reconcileAdvisories(db, ghsaSourceId, [edited])).toEqual({
      fresh: [],
      updated: 1,
      escalated: 1,
    });
    const items = await db.item.findMany({ where: { sourceId: ghsaSourceId } });
    expect(items.map((i) => [i.id, i.title])).toEqual([[itemId, edited.title]]);
    expect(await urgentAtOf(itemId)).toBeNull();

    await sendRuntimeUrgent(db, log, new Date());
    expect(mine()).toHaveLength(3);
    expect(mine()[2].text).toContain("RCE in header parsing");
    expect(mine()[2].text).toContain("pick up PHP 8.3.38");

    // The same advisory again changes nothing.
    expect(await reconcileAdvisories(db, ghsaSourceId, [edited])).toEqual({
      fresh: [],
      updated: 0,
      escalated: 0,
    });
  });
});
