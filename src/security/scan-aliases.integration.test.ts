import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { resetEnvCache } from "@/lib/env";
import { log } from "@/lib/log";
import type { MailMessage } from "@/lib/email/mailer";
import type { OsvHit, OsvQuery, OsvVuln } from "@/sources/osv";

import { mixedHits, mixedQueries, mixedVuln, mixedVulnIds } from "./__fixtures__/osv-mixed";

// OSV answers from the recording of a Composer, PyPI and Go stack (__fixtures__); SMTP is
// stubbed and records every email.
const osv = vi.hoisted(() => ({ fetched: [] as string[], hidden: new Set<string>() }));
const sent = vi.hoisted(() => [] as { to: string; subject: string; text: string }[]);

vi.mock("@/sources/osv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/sources/osv")>();
  return {
    ...actual,
    queryOsvBatchHits: async (queries: OsvQuery[]): Promise<OsvHit[][]> =>
      queries.map((q) => mixedHits(q).filter((h) => !osv.hidden.has(h.id))),
    fetchOsvVuln: async (id: string): Promise<OsvVuln> => {
      osv.fetched.push(id);
      return mixedVuln(id);
    },
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
const { toAdvisoryFields } = await import("@/sources/osv");

// Runs only when TEST_DATABASE_URL points at a migrated, disposable database.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("security-scan collapses OSV aliases", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const saved = { ...process.env };
  const createdPackages: string[] = [];
  const packageIds = new Map<string, string>();
  const orgIds: string[] = [];
  const emails: string[] = [];

  const run = () => securityScan({ db, log, jobId: "j", payload: {}, heartbeat: async () => {} });
  const removeFixtureAdvisories = () =>
    db.advisory.deleteMany({
      where: {
        OR: [{ osvId: { in: mixedVulnIds } }, { packageId: { in: [...packageIds.values()] } }],
      },
    });

  /** An org with one member and one scanned or new repo depending on `names`. */
  async function stack(label: string, names: readonly string[], scanned: Date | null) {
    const suffix = `${label}${Date.now().toString(36)}`;
    const orgId = (await db.org.create({ data: { name: `alias-${suffix}` } })).id;
    orgIds.push(orgId);
    const email = `alias-${suffix}@example.com`;
    emails.push(email);
    const user = await db.user.create({ data: { id: `alias-u-${suffix}`, name: "u", email } });
    await db.orgMember.create({ data: { orgId, userId: user.id } });
    const scoped = withOrg(db, orgId);
    const repo = await scoped.repo.create({
      data: {
        orgId,
        name: `acme/shop-${suffix}`,
        source: "github",
        included: true,
        securityScannedAt: scanned,
      },
    });
    for (const q of mixedQueries.filter((q) => names.includes(q.name))) {
      await scoped.dependency.create({
        data: {
          orgId,
          repoId: repo.id,
          packageId: packageIds.get(q.name) ?? "",
          installedVersion: q.version,
          direct: true,
        },
      });
    }
    return { orgId, repoId: repo.id, email };
  }

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: url,
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "https://app.example.com/",
      NODE_ENV: "test",
    });
    resetEnvCache();
    for (const q of mixedQueries) {
      const key = { ecosystem: q.ecosystem, name: q.name };
      const existing = await db.package.findUnique({ where: { ecosystem_name: key } });
      const pkg = existing ?? (await db.package.create({ data: key }));
      if (!existing) createdPackages.push(pkg.id);
      packageIds.set(q.name, pkg.id);
    }
    await removeFixtureAdvisories();
  });

  afterAll(async () => {
    await db.org.deleteMany({ where: { id: { in: orgIds } } });
    await db.user.deleteMany({ where: { email: { in: emails } } });
    await removeFixtureAdvisories();
    await db.package.deleteMany({ where: { id: { in: createdPackages } } });
    await db.$disconnect();
    process.env = saved;
    resetEnvCache();
  });

  const alertsOf = (orgId: string) =>
    withOrg(db, orgId).alert.findMany({
      select: {
        id: true,
        deliveredAt: true,
        advisory: {
          select: { id: true, osvId: true, severity: true, fixedVersion: true, aliases: true },
        },
      },
      orderBy: { advisory: { osvId: "asc" } },
    });

  it("stores one advisory per vulnerability, with a level and release fixes only", async () => {
    const all = mixedQueries.map((q) => q.name);
    const { orgId, email } = await stack("fresh", all, null);
    osv.fetched.length = 0;
    await run();

    const alerts = await alertsOf(orgId);
    // 77 OSV records, 31 of them the GO-*/PYSEC-* twin of a GHSA (or a second GHSA).
    expect(alerts).toHaveLength(46);
    expect(new Set(alerts.map((a) => a.advisory.osvId)).size).toBe(46);
    expect(alerts.map((a) => a.advisory.osvId).filter((id) => !id.startsWith("GHSA-"))).toEqual([
      "GO-2026-5970",
      "GO-2026-6629",
    ]);
    const gin = alerts.find((a) => a.advisory.osvId === "GHSA-2c4m-59x9-fr2g")?.advisory;
    expect(gin).toMatchObject({
      severity: "MODERATE",
      fixedVersion: "1.9.1",
      aliases: ["CVE-2023-29401", "GO-2023-1737"],
    });
    for (const { advisory } of alerts) {
      expect(advisory.fixedVersion ?? "").not.toMatch(/[0-9a-f]{40}/);
      expect(["LOW", "MODERATE", "HIGH", "CRITICAL", null]).toContain(advisory.severity);
    }
    expect(alerts.filter((a) => a.advisory.severity === null)).toHaveLength(2);
    const guzzle = alerts.find((a) => a.advisory.osvId === "GHSA-f2wf-25xc-69c9")?.advisory;
    expect(guzzle?.fixedVersion).toBe("6.5.7, 7.4.4");
    const certifi = alerts.find((a) => a.advisory.osvId === "GHSA-248v-346w-9cwc")?.advisory;
    expect(certifi?.fixedVersion).toBe("2024.7.4");

    const mine = sent.filter((m) => m.to === email);
    expect(mine.map((m) => m.subject)).toEqual(["Briff · first scan: 46 known advisories"]);

    // Unchanged records are not refetched, and nothing is sent twice.
    osv.fetched.length = 0;
    await run();
    expect(osv.fetched).toEqual([]);
    expect(await alertsOf(orgId)).toHaveLength(46);
    expect(sent.filter((m) => m.to === email)).toHaveLength(1);

    // OSV answering with only the native id still finds the stored GHSA row by its alias.
    osv.hidden = new Set(["GHSA-2c4m-59x9-fr2g"]);
    await run();
    osv.hidden = new Set();
    expect(osv.fetched).toEqual([]);
    expect(await alertsOf(orgId)).toHaveLength(46);
    expect(sent.filter((m) => m.to === email)).toHaveLength(1);

    await db.org.deleteMany({ where: { id: orgId } });
    await removeFixtureAdvisories();
  });

  it("merges duplicates stored by earlier scans on the next scan, without a new delivery", async () => {
    const names = ["github.com/gin-gonic/gin", "requests"];
    const scannedAt = new Date(Date.now() - 86_400_000);
    const { orgId, repoId, email } = await stack("dup", names, scannedAt);
    const scoped = withOrg(db, orgId);

    // What the scan stored before aliases were collapsed: every OSV record its own row, raw
    // CVSS vectors and GIT commits included, `aliases` null. GHSA-h395-qcrw-5vmq was never
    // stored, only its twin GO-2021-0052.
    const seeded = new Map<string, { advisoryId: string; alertId: string }>();
    const minute = (n: number) => new Date(scannedAt.getTime() + n * 60_000);
    let n = 0;
    for (const q of mixedQueries.filter((q) => names.includes(q.name))) {
      for (const { id } of mixedHits(q)) {
        if (id === "GHSA-h395-qcrw-5vmq") continue;
        const vuln = mixedVuln(id);
        const fields = toAdvisoryFields(vuln, q.name, q.ecosystem);
        const ranges = vuln.affected.flatMap((a) => a.ranges ?? []);
        const fixed = ranges.flatMap((r) => r.events.flatMap((e) => (e.fixed ? [e.fixed] : [])));
        const advisory = await db.advisory.create({
          data: {
            ...fields,
            affected: fields.affected as unknown as Prisma.InputJsonValue,
            severity: vuln.database_specific?.severity ?? vuln.severity?.[0]?.score ?? null,
            fixedVersion: fixed.length > 0 ? fixed.join(", ") : null,
            packageId: packageIds.get(q.name) ?? "",
          },
        });
        // The GHSA twin's alert is the newer, undelivered one (a moderate "new" alert held
        // for the bulletin); every other alert went out in the first-scan email.
        const held = id === "GHSA-2c4m-59x9-fr2g";
        const alert = await scoped.alert.create({
          data: {
            orgId,
            repoId,
            advisoryId: advisory.id,
            kind: held ? "new" : "backlog",
            deliveredAt: held ? null : minute(0),
            createdAt: minute(held ? 100 : n++),
          },
        });
        seeded.set(id, { advisoryId: advisory.id, alertId: alert.id });
      }
    }
    expect(seeded.size).toBe(12);

    const result = await run();

    expect(sent.filter((m) => m.to === email)).toEqual([]);
    expect(result.counts).toMatchObject({ advisoriesMerged: 5, alertsMerged: 5 });
    const alerts = await alertsOf(orgId);
    expect(alerts.map((a) => [a.advisory.osvId, a.deliveredAt !== null])).toEqual([
      ["GHSA-2c4m-59x9-fr2g", true],
      ["GHSA-3vp4-m3rf-835h", true],
      ["GHSA-9hjg-9r4m-mvj7", true],
      ["GHSA-9wx4-h78v-vm56", true],
      ["GHSA-gc5v-m9x4-r6x2", true],
      ["GHSA-h395-qcrw-5vmq", true],
      ["GHSA-j8r2-6x86-q33q", true],
    ]);
    // The older GO-* alert was kept and moved; the GHSA row keeps its id.
    const gin = alerts.find((a) => a.advisory.osvId === "GHSA-2c4m-59x9-fr2g");
    expect(gin?.id).toBe(seeded.get("GO-2023-1737")?.alertId);
    expect(gin?.advisory.id).toBe(seeded.get("GHSA-2c4m-59x9-fr2g")?.advisoryId);
    // A native row without its GHSA stored is renamed in place: same row, same alert.
    const renamed = alerts.find((a) => a.advisory.osvId === "GHSA-h395-qcrw-5vmq");
    expect(renamed?.advisory.id).toBe(seeded.get("GO-2021-0052")?.advisoryId);
    expect(renamed?.id).toBe(seeded.get("GO-2021-0052")?.alertId);
    expect(renamed?.advisory.aliases).toEqual([
      "CVE-2020-28483",
      "GO-2021-0052",
      "SNYK-GOLANG-GITHUBCOMGINGONICGIN-1041736",
    ]);
    const requests = alerts.find((a) => a.advisory.osvId === "GHSA-j8r2-6x86-q33q")?.advisory;
    expect(requests).toMatchObject({ severity: "MODERATE", fixedVersion: "2.31.0" });
    expect(
      await db.advisory.count({
        where: { osvId: { in: ["GO-2023-1737", "GO-2021-0052", "PYSEC-2023-74"] } },
      })
    ).toBe(0);

    // The merge is done once: the next scan finds nothing to merge or send.
    const again = await run();
    expect(again.counts).toMatchObject({ advisoriesMerged: 0, alertsMerged: 0 });
    expect(sent.filter((m) => m.to === email)).toEqual([]);
  });
});
