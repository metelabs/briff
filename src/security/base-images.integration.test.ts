import { prepareStream } from "@/pipeline/weekly";
import { readFileSync } from "node:fs";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { resetEnvCache } from "@/lib/env";
import { log } from "@/lib/log";
import { ingestScan } from "@/lib/scan/ingest";
import { osvVulnSchema, type OsvVuln } from "@/sources/osv";
import { collectFromFiles } from "@scan/collect";

import { baseImageScan } from "./base-images";
import { loadBaseImageGroups, loadUnfixedDistros } from "./base-image-view";

const mail = vi.hoisted(() => ({
  sent: [] as { subject: string; text: string }[],
  beforeSend: undefined as (() => Promise<void>) | undefined,
}));
vi.mock("@/lib/email/mailer", () => ({
  smtpConfig: () => ({ host: "example.com" }),
  sendMail: async (message: { subject: string; text: string }) => {
    await mail.beforeSend?.();
    mail.sent.push({ subject: message.subject, text: message.text });
    return { status: "sent" };
  },
}));
const url = process.env.TEST_DATABASE_URL;
const DAY = 86_400_000;

/** OSV `/v1/query` answers for openssl, recorded on 2026-10-30 (Debian:12 trimmed to 26). */
function recorded(name: string): OsvVuln[] {
  const raw = JSON.parse(
    readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8")
  ) as { vulns: unknown[] };
  return raw.vulns.map((v) => osvVulnSchema.parse(v));
}

/** The record with its fixed event for `ecosystem` moved to `version` (a new upload). */
function refixed(vuln: OsvVuln, ecosystem: string, version: string): OsvVuln {
  return {
    ...vuln,
    affected: vuln.affected.map((a) =>
      a.package.ecosystem !== ecosystem
        ? a
        : {
            ...a,
            ranges: (a.ranges ?? []).map((r) => ({
              ...r,
              events: r.events.map((e) => (e.fixed ? { fixed: version } : e)),
            })),
          }
    ),
  };
}

describe.skipIf(!url)("base image scan against Postgres", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const orgs: string[] = [];
  const users: string[] = [];
  let osv: Record<string, OsvVuln[]> = {};
  let queries = 0;

  beforeEach(async () => {
    vi.stubEnv("DATABASE_URL", url ?? "");
    vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-test-secret-with-at-least-32-characters");
    vi.stubEnv("BETTER_AUTH_URL", "https://example.com");
    resetEnvCache();
    mail.sent = [];
    osv = {};
    // The catalog is global; every test starts before the first query of its releases.
    await db.baseImageFix.deleteMany({ where: { ecosystem: { in: ["Debian:11", "Debian:12"] } } });
    await db.baseImageDistro.deleteMany({
      where: { ecosystem: { in: ["Debian:11", "Debian:12"] } },
    });
    // Other orgs left by earlier tests must not be scanned again.
    await db.org.updateMany({ where: { id: { in: orgs } }, data: { baseImageAlerts: false } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        if (String(input) !== "https://api.osv.dev/v1/query") throw new Error("Unexpected request");
        queries++;
        const body = JSON.parse(String(init?.body)) as {
          package: { name: string; ecosystem: string };
        };
        expect(body).not.toHaveProperty("version");
        return Response.json({
          vulns: osv[`${body.package.ecosystem} ${body.package.name}`] ?? [],
        });
      })
    );
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetEnvCache();
    await db.org.deleteMany({ where: { id: { in: orgs } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  });

  async function orgWith(
    dockerfile: string,
    enabled = true,
    repoName = "acme/web"
  ): Promise<string> {
    const id = `base-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await db.user.create({ data: { id, name: "Acme", email: `${id}@example.com` } });
    users.push(user.id);
    const org = await db.org.create({ data: { name: "acme", baseImageAlerts: enabled } });
    orgs.push(org.id);
    await withOrg(db, org.id).orgMember.create({ data: { orgId: org.id, userId: user.id } });
    await addRepo(org.id, repoName, dockerfile);
    return org.id;
  }

  async function addRepo(orgId: string, name: string, dockerfile: string): Promise<void> {
    const repo = await collectFromFiles(
      name,
      { Dockerfile: dockerfile },
      { warn: () => undefined }
    );
    if (!repo) throw new Error("Missing fixture repo");
    await ingestScan(db, orgId, { source: "github", repos: [repo] });
    await withOrg(db, orgId).repo.updateMany({ where: { name }, data: { included: true } });
  }

  const context = {
    db,
    log,
    jobId: "base-images-test",
    payload: {},
    heartbeat: async () => undefined,
  };

  it("first run of an image creates no backlog alerts and sends no email", async () => {
    const debian12 = recorded("osv-debian12-openssl.json");
    osv = { "Debian:12 openssl": debian12 };
    const orgId = await orgWith("FROM node:22-bookworm-slim");
    const disabled = await orgWith("FROM node:22-bookworm-slim", false);

    const result = await baseImageScan(context);

    // Before the fix window, every one of these became an alert and one email went out.
    expect(result.counts?.candidates).toBe(debian12.length);
    expect(await withOrg(db, orgId).baseImageAlert.count()).toBe(0);
    expect(mail.sent).toHaveLength(0);
    expect(await withOrg(db, orgId).baseImageWatch.count()).toBe(1);
    expect(await withOrg(db, disabled).baseImageWatch.count()).toBe(0);
    // The baseline dates only announcements; all of these are long published.
    const catalog = await db.baseImageFix.findMany({ where: { ecosystem: "Debian:12" } });
    expect(catalog.length).toBeGreaterThan(0);
    for (const row of catalog)
      expect(row.fixedAt === null || row.fixedAt.getTime() < Date.now() - 30 * DAY).toBe(true);
    expect(await loadUnfixedDistros(db, orgId, { included: true })).toEqual([
      { distro: "debian 12", unfixed: 1 },
    ]);
    expect(await loadUnfixedDistros(db, disabled, { included: true })).toEqual([]);

    await baseImageScan(context);
    expect(await withOrg(db, orgId).baseImageAlert.count()).toBe(0);
    expect(mail.sent).toHaveLength(0);
  });

  it("a fix published 3 days ago creates one grouped alert, emailed once", async () => {
    const debian12 = recorded("osv-debian12-openssl.json");
    osv = { "Debian:12 openssl": debian12 };
    const orgId = await orgWith("FROM node:22-bookworm-slim");
    const scoped = withOrg(db, orgId);
    await baseImageScan(context);
    expect(mail.sent).toHaveLength(0);
    // The image has been watched for ten days when the fixes come out.
    await scoped.baseImageWatch.updateMany({ data: { since: new Date(Date.now() - 10 * DAY) } });

    const byId = new Map(debian12.map((v) => [v.id, v]));
    const take = (id: string) => {
      const vuln = byId.get(id);
      if (!vuln) throw new Error(`Missing ${id}`);
      return vuln;
    };
    const announced = "3.0.22-1~deb12u3";
    const dsa: OsvVuln = {
      ...refixed(take("DSA-6113-1"), "Debian:12", announced),
      id: "DSA-6299-1",
      published: new Date(Date.now() - 3 * DAY).toISOString(),
      upstream: ["CVE-2026-35189", "DEBIAN-CVE-2026-35189", "DEBIAN-CVE-2026-75803"],
    };
    osv = {
      "Debian:12 openssl": [
        ...debian12.filter(
          (v) =>
            !["DEBIAN-CVE-2026-35189", "DEBIAN-CVE-2026-75803", "DEBIAN-CVE-2026-84782"].includes(
              v.id
            )
        ),
        dsa,
        refixed(take("DEBIAN-CVE-2026-35189"), "Debian:12", announced),
        refixed(take("DEBIAN-CVE-2026-75803"), "Debian:12", announced),
        // A point-release fix without an announcement: dated by the run that first sees it.
        refixed(take("DEBIAN-CVE-2026-84782"), "Debian:12", "3.0.22-1~deb12u4"),
      ],
    };
    // A repo added today runs the same image: it starts after these fixes, so no alert.
    await addRepo(orgId, "acme/api", "FROM node:22-bookworm-slim");
    await baseImageScan(context);

    const rows = await scoped.baseImageAlert.findMany({ include: { repo: true } });
    expect(rows.map((r) => [r.repo.name, r.osvId]).sort()).toEqual([
      ["acme/web", "DEBIAN-CVE-2026-84782"],
      ["acme/web", "DSA-6299-1"],
    ]);
    // The announcement carries the highest severity of the CVE records it fixes.
    expect(rows.find((r) => r.osvId === "DSA-6299-1")?.severity).toBe("CRITICAL");
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].subject).toBe("Briff · base image fixes: node:22-bookworm-slim");
    expect(mail.sent[0].text).toContain("To do: rebuild on the latest node:22-bookworm-slim tag");
    expect(mail.sent[0].text).toContain("DSA-6299-1 · CRITICAL · openssl");
    expect(mail.sent[0].text).not.toContain("acme/api");
    const groups = await loadBaseImageGroups(db, orgId, { included: true });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ image: "node:22-bookworm-slim", repo: "acme/web" });
    expect(groups[0].advisories.map((a) => a.osvId)).toEqual([
      "DSA-6299-1",
      "DEBIAN-CVE-2026-84782",
    ]);

    await baseImageScan(context);
    expect(mail.sent).toHaveLength(1);
    expect(await scoped.baseImageAlert.count()).toBe(2);

    // Two runs overlapping on delivery send it once.
    await scoped.baseImageAlert.updateMany({ data: { deliveredAt: null } });
    let releaseSend: () => void = () => undefined;
    let reachedSend: () => void = () => undefined;
    const sending = new Promise<void>((resolve) => {
      reachedSend = resolve;
    });
    const holdSend = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    mail.beforeSend = async () => {
      reachedSend();
      await holdSend;
    };
    const first = baseImageScan(context);
    try {
      await sending;
      const overlapping = await baseImageScan(context);
      expect(overlapping.counts?.deliveryLocked).toBe(1);
    } finally {
      releaseSend();
      await first;
      mail.beforeSend = undefined;
    }
    expect(mail.sent).toHaveLength(2);
    expect(await scoped.baseImageAlert.count({ where: { deliveredAt: null } })).toBe(0);

    // The weekly bulletin of the stream picks the group up.
    const stream = await scoped.bulletinStream.create({
      data: { orgId, name: "Weekly", slug: "weekly" },
    });
    const repo = await scoped.repo.findFirstOrThrow({ where: { name: "acme/web" } });
    await scoped.streamRepo.create({ data: { orgId, streamId: stream.id, repoId: repo.id } });
    const now = new Date(Date.now() + 1000);
    expect(
      await prepareStream(
        db,
        orgId,
        { id: stream.id, name: stream.name, repoIds: [repo.id] },
        {
          now,
          weekStart: now,
          week: "W44",
          language: "en",
          model: "synthetic",
          promptVersion: "synthetic",
        }
      )
    ).not.toBeNull();

    // OSV takes the point-release fix back: that alert is no longer shown.
    osv = {
      "Debian:12 openssl": osv["Debian:12 openssl"].map((v) =>
        v.id === "DEBIAN-CVE-2026-84782" ? { ...v, affected: [] } : v
      ),
    };
    await baseImageScan(context);
    expect(
      (await scoped.baseImageAlert.findMany({ where: { active: true } })).map((r) => r.osvId)
    ).toEqual(["DSA-6299-1"]);

    // The window runs from the fix: an undelivered alert whose fix is 20 days old is
    // neither emailed nor listed on Alerts, however recently its row was stored.
    const stale = new Date(Date.now() - 20 * DAY);
    await db.baseImageFix.updateMany({
      where: { ecosystem: "Debian:12", version: announced },
      data: { fixedAt: stale },
    });
    await scoped.baseImageAlert.updateMany({ data: { fixedAt: stale, deliveredAt: null } });
    await baseImageScan(context);
    expect(mail.sent).toHaveLength(2);
    expect(await loadBaseImageGroups(db, orgId, { included: true })).toEqual([]);
    expect(queries).toBeGreaterThan(0);
  });

  it("an EOL distro yields the move action and an unrated fix waits for the bulletin", async () => {
    const debian11 = recorded("osv-debian11-openssl.json");
    osv = { "Debian:11 openssl": debian11 };
    const orgId = await orgWith("FROM debian:11-slim");
    const scoped = withOrg(db, orgId);
    await baseImageScan(context);
    expect(await scoped.baseImageAlert.count()).toBe(0);
    await scoped.baseImageWatch.updateMany({ data: { since: new Date(Date.now() - 10 * DAY) } });
    const dla = debian11.find((v) => v.id === "DLA-4490-1");
    if (!dla) throw new Error("Missing DLA-4490-1");
    osv = {
      "Debian:11 openssl": [
        ...debian11,
        {
          ...refixed(dla, "Debian:11", "1.1.1w-0+deb11u6"),
          id: "DLA-4599-1",
          published: new Date(Date.now() - 3 * DAY).toISOString(),
          upstream: ["CVE-2026-99999"],
        },
      ],
    };
    await baseImageScan(context);

    const rows = await scoped.baseImageAlert.findMany();
    expect(rows.map((r) => [r.osvId, r.severity, r.action])).toEqual([
      ["DLA-4599-1", null, "debian 11 is end-of-life; migrate to debian 12 or later"],
    ]);
    expect(mail.sent).toHaveLength(0);
    expect(rows[0].deliveredAt).toBeNull();

    // A repo included again yesterday starts over: a fix from two days ago is not news,
    // and a held alert from before is retired instead of emailed.
    await scoped.baseImageAlert.updateMany({ data: { severity: "HIGH" } });
    const included = new Date(Date.now() - DAY);
    await scoped.repo.updateMany({ data: { includedChangedAt: included } });
    osv["Debian:11 openssl"].push({
      ...refixed(dla, "Debian:11", "1.1.1w-0+deb11u7"),
      id: "DLA-4600-1",
      published: new Date(Date.now() - 2 * DAY).toISOString(),
    });
    await baseImageScan(context);
    expect(
      (await scoped.baseImageAlert.findMany()).map((r) => [r.osvId, r.active, r.deliveredAt])
    ).toEqual([["DLA-4599-1", false, null]]);
    expect(mail.sent).toHaveLength(0);
    expect((await scoped.baseImageWatch.findFirstOrThrow()).since).toEqual(included);
  });
});
