import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { resetEnvCache } from "@/lib/env";
import { log } from "@/lib/log";
import type { MailMessage } from "@/lib/email/mailer";
import type { OsvHit, OsvQuery, OsvVuln } from "@/sources/osv";

// OSV and SMTP are stubbed: the test drives which advisories exist and records every email.
const osv = vi.hoisted(() => ({
  vulns: new Map<string, { pkg: string; ecosystem?: string; vuln: unknown }>(),
  queries: [] as OsvQuery[],
}));
const sent = vi.hoisted(() => [] as { to: string; subject: string; text: string }[]);

vi.mock("@/sources/osv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/sources/osv")>();
  return {
    ...actual,
    queryOsvBatchHits: async (queries: OsvQuery[]): Promise<OsvHit[][]> => {
      osv.queries.push(...queries);
      return queries.map((q) =>
        [...osv.vulns.entries()]
          .filter(([, v]) => v.pkg === q.name && (v.ecosystem ?? "npm") === (q.ecosystem ?? "npm"))
          .map(([id, v]) => ({ id, modified: (v.vuln as OsvVuln).modified }))
      );
    },
    fetchOsvVuln: async (id: string): Promise<OsvVuln> =>
      actual.osvVulnSchema.parse(osv.vulns.get(id)?.vuln),
  };
});
vi.mock("@/lib/email/mailer", () => ({
  smtpConfig: () => ({ host: "h", port: 587, user: "u", pass: "p", from: "f@example.com" }),
  sendMail: async (msg: MailMessage) => {
    sent.push({ to: msg.to, subject: msg.subject, text: msg.text });
    return { status: "sent", messageId: "m" };
  },
}));

const { securityScan } = await import("./scan");
const { loadBulletinView } = await import("@/pipeline/bulletin-view");

// Runs only when TEST_DATABASE_URL points at a migrated, disposable database.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("security-scan alert kinds and the email threshold", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  const saved = { ...process.env };
  const email = `scan-${suffix}@example.com`;
  const pkgDirect = `next-${suffix}`;
  const pkgTransitive = `undici-${suffix}`;
  let orgId = "";
  let repoId = "";

  const vuln = (id: string, pkg: string, severity: string, fixed: string) => {
    osv.vulns.set(id, {
      pkg,
      vuln: {
        id,
        modified: new Date().toISOString(),
        summary: `${id} summary`,
        database_specific: { severity },
        affected: [
          {
            package: { ecosystem: "npm", name: pkg },
            ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed }] }],
          },
        ],
      },
    });
  };
  const run = () => securityScan({ db, log, jobId: "j", payload: {}, heartbeat: async () => {} });
  const mine = () => sent.filter((m) => m.to === email);

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: url,
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "https://app.example.com/",
      NODE_ENV: "test",
    });
    resetEnvCache();
    orgId = (await db.org.create({ data: { name: `scan-${suffix}` } })).id;
    const user = await db.user.create({ data: { id: `scan-u-${suffix}`, name: "u", email } });
    await db.orgMember.create({ data: { orgId, userId: user.id } });
    const scoped = withOrg(db, orgId);
    const repo = await scoped.repo.create({
      data: { orgId, name: `briff-${suffix}`, source: "local", included: true },
    });
    repoId = repo.id;
    for (const [name, version, direct] of [
      [pkgDirect, "15.0.0", true],
      [pkgTransitive, "7.20.0", false],
    ] as const) {
      const pkg = await db.package.create({ data: { ecosystem: "npm", name } });
      await scoped.dependency.create({
        data: { orgId, repoId, packageId: pkg.id, installedVersion: version, direct },
      });
    }
  });

  afterAll(async () => {
    await db.org.deleteMany({ where: { id: orgId } });
    await db.user.deleteMany({ where: { email } });
    await db.package.deleteMany({ where: { name: { in: [pkgDirect, pkgTransitive] } } });
    await db.$disconnect();
    process.env = saved;
    resetEnvCache();
  });

  it("files the first scan as backlog and sends one summary instead of each advisory", async () => {
    vuln(`GHSA-a-${suffix}`, pkgDirect, "HIGH", "15.0.5");
    vuln(`GHSA-b-${suffix}`, pkgTransitive, "LOW", "7.29.1");
    await run();
    const alerts = await withOrg(db, orgId).alert.findMany({
      select: { kind: true, deliveredAt: true },
    });
    expect(alerts.map((a) => a.kind)).toEqual(["backlog", "backlog"]);
    expect(alerts.every((a) => a.deliveredAt !== null)).toBe(true);
    expect(mine()).toHaveLength(1);
    expect(mine()[0].subject).toBe("Briff · first scan: 2 known advisories");
    expect(mine()[0].text).toContain("https://app.example.com/bulletins");
    const repo = await withOrg(db, orgId).repo.findFirst({ where: { id: repoId } });
    expect(repo?.securityScannedAt).not.toBeNull();
  });

  it("emails only new critical/high alerts and holds moderate ones for the bulletin", async () => {
    vuln(`GHSA-c-${suffix}`, pkgDirect, "CRITICAL", "15.0.6");
    vuln(`GHSA-d-${suffix}`, pkgDirect, "MODERATE", "15.0.7");
    await run();
    const rows = await withOrg(db, orgId).alert.findMany({
      where: { kind: "new" },
      select: { deliveredAt: true, advisory: { select: { osvId: true } } },
      orderBy: { advisory: { osvId: "asc" } },
    });
    expect(rows.map((r) => [r.advisory.osvId, r.deliveredAt !== null])).toEqual([
      [`GHSA-c-${suffix}`, true],
      [`GHSA-d-${suffix}`, false],
    ]);
    expect(mine()).toHaveLength(2);
    expect(mine()[1].subject).toBe(`Briff · security: ${pkgDirect}`);
    expect(mine()[1].text).toContain(`GHSA-c-${suffix}`);
    expect(mine()[1].text).not.toContain(`GHSA-d-${suffix}`);
  });

  it("sends nothing twice", async () => {
    await run();
    expect(mine()).toHaveLength(2);
  });

  it("lists new and first-scan advisories in separate groups on the bulletin view", async () => {
    const bulletin = await withOrg(db, orgId).bulletin.create({
      data: {
        orgId,
        weekStart: new Date("2026-10-19T00:00:00Z"),
        periodStart: new Date(Date.now() - 86_400_000),
        periodEnd: new Date(Date.now() + 60_000),
        model: "fake",
        promptVersion: "synthesis-v5",
        summary: "",
        inputHash: "h",
      },
    });
    const view = await loadBulletinView(db, orgId, bulletin.id);
    expect(view?.alerts.map((a) => [a.packageName, a.osvIds.length, a.transitive])).toEqual([
      [pkgDirect, 2, false],
    ]);
    expect(view?.backlogAlerts.map((a) => [a.packageName, a.transitive, a.fixed])).toEqual([
      [pkgDirect, false, "15.0.5"],
      [pkgTransitive, true, null],
    ]);
  });
});

describe.skipIf(!url)("security-scan per ecosystem", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = `eco${Date.now().toString(36)}`;
  const composerName = `acme/log-${suffix}`;
  const npmName = `log-${suffix}`;
  const pypiName = `acme-log-${suffix}`;
  const looseName = `acme-loose-${suffix}`;
  const goName = `github.com/acme/log-${suffix}`;
  const saved = { ...process.env };
  let orgId = "";
  let repoId = "";

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: url,
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "https://app.example.com/",
      NODE_ENV: "test",
    });
    resetEnvCache();
    orgId = (await db.org.create({ data: { name: `scan-${suffix}` } })).id;
    const scoped = withOrg(db, orgId);
    repoId = (
      await scoped.repo.create({
        data: { orgId, name: `acme/shop-${suffix}`, source: "github", included: true },
      })
    ).id;
    for (const [ecosystem, name] of [
      ["Packagist", composerName],
      ["npm", npmName],
      ["PyPI", pypiName],
      ["Go", goName],
    ] as const) {
      const pkg = await db.package.create({ data: { ecosystem, name } });
      await scoped.dependency.create({
        data: { orgId, repoId, packageId: pkg.id, installedVersion: "3.0.2", direct: true },
      });
    }
    // A requirements.txt range: matched for releases, never sent to OSV.
    const loose = await db.package.create({ data: { ecosystem: "PyPI", name: looseName } });
    await scoped.dependency.create({
      data: {
        orgId,
        repoId,
        packageId: loose.id,
        installedVersion: ">=2.0",
        direct: true,
        manager: "pip",
        unresolved: true,
      },
    });
    osv.vulns.set(`GHSA-p-${suffix}`, {
      pkg: composerName,
      ecosystem: "Packagist",
      vuln: {
        id: `GHSA-p-${suffix}`,
        modified: new Date().toISOString(),
        database_specific: { severity: "HIGH" },
        affected: [
          {
            package: { ecosystem: "Packagist", name: composerName },
            ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "v3.0.3" }] }],
          },
        ],
      },
    });
  });

  afterAll(async () => {
    await db.org.deleteMany({ where: { id: orgId } });
    await db.package.deleteMany({
      where: { name: { in: [composerName, npmName, pypiName, looseName, goName] } },
    });
    await db.$disconnect();
    process.env = saved;
    resetEnvCache();
  });

  it("queries each package in its own ecosystem, never an unresolved requirement, and alerts only the Packagist one", async () => {
    osv.queries.length = 0;
    await securityScan({ db, log, jobId: "j", payload: {}, heartbeat: async () => {} });
    expect(
      osv.queries
        .filter((q) => [composerName, npmName, pypiName, looseName, goName].includes(q.name))
        .sort((a, b) => (a.ecosystem ?? "").localeCompare(b.ecosystem ?? ""))
    ).toEqual([
      { ecosystem: "Go", name: goName, version: "3.0.2" },
      { ecosystem: "npm", name: npmName, version: "3.0.2" },
      { ecosystem: "Packagist", name: composerName, version: "3.0.2" },
      { ecosystem: "PyPI", name: pypiName, version: "3.0.2" },
    ]);
    const alerts = await withOrg(db, orgId).alert.findMany({
      select: {
        advisory: {
          select: {
            fixedVersion: true,
            affected: true,
            package: { select: { ecosystem: true, name: true } },
          },
        },
      },
    });
    expect(alerts).toEqual([
      {
        advisory: {
          fixedVersion: "3.0.3",
          affected: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "3.0.3" }] }],
          package: { ecosystem: "Packagist", name: composerName },
        },
      },
    ]);
  });
});
