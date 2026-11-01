import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { resetEnvCache } from "@/lib/env";
import { log } from "@/lib/log";
import type { MailMessage } from "@/lib/email/mailer";
import type { ScanBody } from "@/lib/scan/schema";
import type { OsvHit, OsvQuery, OsvVuln } from "@/sources/osv";

// OSV and SMTP are stubbed as in scan.integration.test.ts.
const osv = vi.hoisted(() => ({ vulns: new Map<string, { pkg: string; vuln: unknown }>() }));
const sent = vi.hoisted(() => [] as { to: string }[]);

vi.mock("@/sources/osv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/sources/osv")>();
  const affects = (vuln: unknown, name: string, version: string) =>
    actual.osvVulnSchema
      .parse(vuln)
      .affected.some((a) => a.package?.name === name && actual.isAffected(a.ranges ?? [], version));
  return {
    ...actual,
    queryOsvBatchHits: async (queries: OsvQuery[]): Promise<OsvHit[][]> =>
      queries.map((q) =>
        [...osv.vulns.entries()]
          .filter(([, v]) => v.pkg === q.name && affects(v.vuln, q.name, q.version))
          .map(([id, v]) => ({ id, modified: (v.vuln as OsvVuln).modified }))
      ),
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
const { ingestScan } = await import("@/lib/scan/ingest");

// Runs only when TEST_DATABASE_URL points at a migrated, disposable database.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("alerts resolve on a newer scan", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  const saved = { ...process.env };
  const email = `resolve-${suffix}@example.com`;
  const pkg = `lodash-${suffix}`;
  const osvId = `GHSA-resolve-${suffix}`;
  const repoName = `garden-${suffix}`;
  let orgId = "";
  let otherOrgId = "";

  const setVuln = (fixed: string) =>
    osv.vulns.set(osvId, {
      pkg,
      vuln: {
        id: osvId,
        modified: new Date().toISOString(),
        database_specific: { severity: "HIGH" },
        affected: [
          {
            package: { ecosystem: "npm", name: pkg },
            ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed }] }],
          },
        ],
      },
    });
  const upload = (version: string): ScanBody => ({
    source: "local",
    repos: [
      {
        name: repoName,
        ecosystem: "npm",
        dependencies: [
          { name: pkg, version, direct: true },
          { name: `other-${suffix}`, version: "1.0.0", direct: true },
        ],
      },
    ],
  });
  const run = () => securityScan({ db, log, jobId: "j", payload: {}, heartbeat: async () => {} });
  const alertOf = (org: string) =>
    withOrg(db, org).alert.findFirstOrThrow({
      where: { advisory: { osvId } },
      select: { resolvedAt: true, deliveredAt: true },
    });

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: url,
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "https://app.example.com/",
      NODE_ENV: "test",
    });
    resetEnvCache();
    orgId = (await db.org.create({ data: { name: `resolve-${suffix}` } })).id;
    otherOrgId = (await db.org.create({ data: { name: `resolve-other-${suffix}` } })).id;
    const user = await db.user.create({ data: { id: `resolve-u-${suffix}`, name: "u", email } });
    await db.orgMember.create({ data: { orgId, userId: user.id } });
    for (const org of [orgId, otherOrgId]) {
      await ingestScan(db, org, upload("4.17.20"));
      await withOrg(db, org).repo.updateMany({ data: { included: true } });
    }
    setVuln("4.17.21");
    await run();
  });

  afterAll(async () => {
    await db.org.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
    await db.user.deleteMany({ where: { email } });
    await db.advisory.deleteMany({ where: { osvId } });
    await db.package.deleteMany({ where: { name: { in: [pkg, `other-${suffix}`] } } });
    await db.$disconnect();
    process.env = saved;
    resetEnvCache();
  });

  it("resolves the alert when the next upload has the fixed version, in that org only", async () => {
    expect((await alertOf(orgId)).resolvedAt).toBeNull();
    expect((await db.advisory.findUniqueOrThrow({ where: { osvId } })).packages).toEqual([
      { ecosystem: "npm", name: pkg },
    ]);
    const [result] = await ingestScan(db, orgId, upload("4.17.21"));
    expect(result).toMatchObject({ alertsResolved: 1, alertsReopened: 0 });
    const alert = await alertOf(orgId);
    expect(alert.resolvedAt).not.toBeNull();
    // The row stays, with its delivery state: nothing is emailed again.
    expect(alert.deliveredAt).not.toBeNull();
    expect((await alertOf(otherOrgId)).resolvedAt).toBeNull();
  });

  it("keeps it resolved on a re-upload and reopens it when the vulnerable version is back", async () => {
    const [same] = await ingestScan(db, orgId, upload("4.17.21"));
    expect(same).toMatchObject({ alertsResolved: 0, alertsReopened: 0 });
    const [back] = await ingestScan(db, orgId, upload("4.17.19"));
    expect(back).toMatchObject({ alertsResolved: 0, alertsReopened: 1 });
    expect((await alertOf(orgId)).resolvedAt).toBeNull();
  });

  it("records the covered packages of an older advisory even when OSV no longer answers with it", async () => {
    const legacyId = `GHSA-legacy-${suffix}`;
    const pkgRow = await db.package.findFirstOrThrow({ where: { name: pkg } });
    await db.advisory.create({ data: { osvId: legacyId, packageId: pkgRow.id, affected: [] } });
    osv.vulns.set(legacyId, {
      pkg,
      vuln: {
        id: legacyId,
        modified: new Date().toISOString(),
        affected: [
          {
            package: { ecosystem: "npm", name: pkg },
            ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "1.0.0" }] }],
          },
        ],
      },
    });
    await run();
    const row = await db.advisory.findUniqueOrThrow({ where: { osvId: legacyId } });
    expect(row.packages).toEqual([{ ecosystem: "npm", name: pkg }]);
    osv.vulns.delete(legacyId);
    await db.advisory.delete({ where: { id: row.id } });
  });

  it("reopens a resolved alert when OSV widens the range, without a second email", async () => {
    await ingestScan(db, orgId, upload("4.17.21"));
    expect((await alertOf(orgId)).resolvedAt).not.toBeNull();
    const before = sent.filter((m) => m.to === email).length;
    setVuln("4.17.22");
    await run();
    expect((await alertOf(orgId)).resolvedAt).toBeNull();
    expect(sent.filter((m) => m.to === email)).toHaveLength(before);
  });
});
