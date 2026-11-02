import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";
import semver from "semver";

import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { resetEnvCache } from "@/lib/env";
import { log } from "@/lib/log";
import type { MailMessage } from "@/lib/email/mailer";
import type { OsvHit, OsvQuery, OsvVuln } from "@/sources/osv";

// "Re-check now" queues security-scan with { orgId, manual: true }: only that org's repos are
// queried, alerts OSV no longer reports for the stored version resolve, nothing is re-sent.
const osv = vi.hoisted(() => ({
  vulns: new Map<string, { pkg: string; fixed: string; vuln: unknown }>(),
  queries: [] as OsvQuery[],
}));
const sent = vi.hoisted(() => [] as { to: string }[]);

vi.mock("@/sources/osv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/sources/osv")>();
  return {
    ...actual,
    queryOsvBatchHits: async (queries: OsvQuery[]): Promise<OsvHit[][]> => {
      osv.queries.push(...queries);
      return queries.map((q) =>
        [...osv.vulns.entries()]
          .filter(([, v]) => v.pkg === q.name && semver.lt(q.version, v.fixed))
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
    sent.push({ to: msg.to });
    return { status: "sent", messageId: "m" };
  },
}));

const { securityScan } = await import("./scan");
const { loadJobHealth } = await import("@/lib/ops/health");

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("security-scan scoped to one org", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  const saved = { ...process.env };
  const pkgName = `scoped-${suffix}`;
  const orgs: { orgId: string; repoId: string; depId: string; email: string }[] = [];
  let packageId = "";

  const run = (payload: object) =>
    securityScan({ db, log, jobId: "j", payload: { ...payload }, heartbeat: async () => {} });
  const alertOf = (orgId: string) =>
    withOrg(db, orgId).alert.findFirstOrThrow({
      select: { resolvedAt: true, resolvedBy: true, deliveredAt: true },
    });

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: url,
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "https://app.example.com/",
      NODE_ENV: "test",
    });
    resetEnvCache();
    packageId = (await db.package.create({ data: { ecosystem: "npm", name: pkgName } })).id;
    for (const name of ["a", "b"]) {
      const orgId = (await db.org.create({ data: { name: `scoped-${name}-${suffix}` } })).id;
      const email = `scoped-${name}-${suffix}@example.com`;
      const user = await db.user.create({
        data: { id: `scoped-${name}-${suffix}`, name, email },
      });
      await db.orgMember.create({ data: { orgId, userId: user.id } });
      const scoped = withOrg(db, orgId);
      const repo = await scoped.repo.create({
        data: { orgId, name: `repo-${name}-${suffix}`, source: "local", included: true },
      });
      const dep = await scoped.dependency.create({
        data: { orgId, repoId: repo.id, packageId, installedVersion: "1.0.0", direct: true },
      });
      orgs.push({ orgId, repoId: repo.id, depId: dep.id, email });
    }
    const id = `GHSA-scoped-${suffix}`;
    osv.vulns.set(id, {
      pkg: pkgName,
      fixed: "1.0.1",
      vuln: {
        id,
        modified: new Date().toISOString(),
        summary: "scoped",
        database_specific: { severity: "HIGH" },
        affected: [
          {
            package: { ecosystem: "npm", name: pkgName },
            ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "1.0.1" }] }],
          },
        ],
      },
    });
  });

  afterAll(async () => {
    await db.org.deleteMany({ where: { id: { in: orgs.map((o) => o.orgId) } } });
    await db.user.deleteMany({ where: { email: { in: orgs.map((o) => o.email) } } });
    await db.advisory.deleteMany({ where: { packageId } });
    await db.package.deleteMany({ where: { id: packageId } });
    await db.$disconnect();
    process.env = saved;
    resetEnvCache();
  });

  it("queries only the org's repos and resolves what OSV no longer reports", async () => {
    await run({});
    const [a, b] = orgs;
    for (const o of orgs) expect((await alertOf(o.orgId)).resolvedAt).toBeNull();
    const bScannedAt = (await withOrg(db, b.orgId).repo.findFirstOrThrow({})).securityScannedAt;

    // Both repos now store the fixed version (e.g. an upload whose check could not resolve).
    for (const o of orgs) {
      await withOrg(db, o.orgId).dependency.updateMany({
        where: { id: o.depId },
        data: { installedVersion: "1.0.1" },
      });
    }
    osv.queries.length = 0;
    const emailsBefore = sent.length;
    const res = await run({ orgId: a.orgId, manual: true });

    expect(res.counts).toMatchObject({ orgs: 1, manual: 1, alertsResolved: 1 });
    expect(osv.queries.every((q) => q.name !== pkgName || q.version === "1.0.1")).toBe(true);
    expect(await alertOf(a.orgId)).toMatchObject({ resolvedBy: "security_scan" });
    expect((await alertOf(a.orgId)).resolvedAt).not.toBeNull();
    // The other org is left alone: still open, not rescanned.
    expect((await alertOf(b.orgId)).resolvedAt).toBeNull();
    expect((await withOrg(db, b.orgId).repo.findFirstOrThrow({})).securityScannedAt).toEqual(
      bScannedAt
    );
    // Already delivered by the daily run: the re-check sends nothing.
    expect(sent.length).toBe(emailsBefore);
  });

  it("reopens a resolved alert when the stored version is affected again", async () => {
    const [a] = orgs;
    await withOrg(db, a.orgId).dependency.updateMany({
      where: { id: a.depId },
      data: { installedVersion: "1.0.0" },
    });
    await run({ orgId: a.orgId, manual: true });
    expect(await alertOf(a.orgId)).toMatchObject({ resolvedAt: null, resolvedBy: null });
  });

  it("does not count a re-check as the daily run for health", async () => {
    const [a] = orgs;
    // Far in the future, so no other run in the shared test database is newer.
    const finishedAt = new Date(Date.now() + 365 * 86_400_000);
    const job = await db.job.create({
      data: {
        type: "security-scan",
        dedupeKey: `security-scan:org:${a.orgId}`,
        payload: { orgId: a.orgId, manual: true },
        status: "succeeded",
      },
    });
    const run = await db.run.create({
      data: { jobId: job.id, jobType: "security-scan", status: "succeeded", finishedAt },
    });
    try {
      const health = await loadJobHealth(db);
      expect(health.freshness["security-scan"]?.lastSuccessAt).not.toEqual(finishedAt);
    } finally {
      await db.run.delete({ where: { id: run.id } });
      await db.job.delete({ where: { id: job.id } });
    }
  });
});
