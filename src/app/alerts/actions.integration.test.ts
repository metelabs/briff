import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { testInstallationId } from "@/test/github-ids";

// Runs only when TEST_DATABASE_URL points at a migrated, disposable database.
const url = process.env.TEST_DATABASE_URL;

const session = vi.hoisted(() => ({ orgId: "" }));
const testDb = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/auth/session", () => ({
  requireOrgContext: async () => ({ userId: "u", email: "u@example.com", name: "u", ...session }),
}));
vi.mock("@/lib/db/client", () => ({ getDb: () => testDb.client }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/stream-scope", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stream-scope")>()),
  loadStreamScope: async () => ({ streams: [], current: null }),
}));

const { markBacklogReviewedAction, markPackageReviewedAction, recheckAction, recheckStatusAction } =
  await import("./actions");

describe.skipIf(!url)("backlog review actions against Postgres", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  testDb.client = db;
  const suffix = Date.now().toString(36);
  const delivered = new Date("2026-10-20T08:00:00Z");
  let orgId = "";
  let otherOrgId = "";
  const packageIds: string[] = [];
  const advisoryIds: string[] = [];

  async function alert(
    org: string,
    repoId: string,
    pkg: string,
    kind: "new" | "backlog"
  ): Promise<string> {
    const advisory = await db.advisory.create({
      data: { osvId: `GHSA-review-${suffix}-${advisoryIds.length}`, packageId: pkg, affected: [] },
    });
    advisoryIds.push(advisory.id);
    const row = await withOrg(db, org).alert.create({
      data: { orgId: org, advisoryId: advisory.id, repoId, kind, deliveredAt: delivered },
    });
    return row.id;
  }

  const ids: Record<string, string> = {};

  beforeAll(async () => {
    orgId = (await db.org.create({ data: { name: `review-${suffix}` } })).id;
    otherOrgId = (await db.org.create({ data: { name: `review-other-${suffix}` } })).id;
    session.orgId = orgId;
    const repo = await withOrg(db, orgId).repo.create({
      data: { orgId, name: `repo-${suffix}`, source: "local", included: true },
    });
    const otherRepo = await withOrg(db, otherOrgId).repo.create({
      data: { orgId: otherOrgId, name: `repo-${suffix}`, source: "local", included: true },
    });
    for (const name of ["a", "b"]) {
      packageIds.push(
        (await db.package.create({ data: { ecosystem: "npm", name: `review-${name}-${suffix}` } }))
          .id
      );
    }
    const [a, b] = packageIds;
    ids.backlogA = await alert(orgId, repo.id, a, "backlog");
    ids.backlogB = await alert(orgId, repo.id, b, "backlog");
    ids.newA = await alert(orgId, repo.id, a, "new");
    ids.otherBacklog = await alert(otherOrgId, otherRepo.id, a, "backlog");
  });

  afterAll(async () => {
    await db.org.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
    await db.advisory.deleteMany({ where: { id: { in: advisoryIds } } });
    await db.package.deleteMany({ where: { id: { in: packageIds } } });
    await db.$disconnect();
  });

  const state = async (id: string, org = orgId) =>
    withOrg(db, org).alert.findFirstOrThrow({
      where: { id },
      select: { reviewedAt: true, deliveredAt: true, kind: true },
    });

  it("marks one package's backlog, leaving new alerts and other packages alone", async () => {
    const form = new FormData();
    form.set("packageName", `review-a-${suffix}`);
    expect(await markPackageReviewedAction({ ok: true, message: null }, form)).toMatchObject({
      ok: true,
    });
    expect((await state(ids.backlogA)).reviewedAt).not.toBeNull();
    expect((await state(ids.backlogB)).reviewedAt).toBeNull();
    expect((await state(ids.newA)).reviewedAt).toBeNull();
    // Delivery state is untouched.
    expect((await state(ids.backlogA)).deliveredAt?.toISOString()).toBe(delivered.toISOString());
  });

  it("marks the rest of the org's backlog, never another org's or a new alert", async () => {
    const first = (await state(ids.backlogA)).reviewedAt;
    expect(await markBacklogReviewedAction()).toMatchObject({ ok: true });
    expect((await state(ids.backlogB)).reviewedAt).not.toBeNull();
    // Already reviewed rows keep their first timestamp.
    expect((await state(ids.backlogA)).reviewedAt).toEqual(first);
    expect((await state(ids.newA)).reviewedAt).toBeNull();
    expect((await state(ids.otherBacklog, otherOrgId)).reviewedAt).toBeNull();
    expect(await markBacklogReviewedAction()).toEqual({
      ok: true,
      message: "No backlog left to review.",
    });
  });
});

describe.skipIf(!url)("re-check action against Postgres", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  const installationId = testInstallationId();
  let orgId = "";
  let scannerOrgId = "";
  let emptyOrgId = "";
  const jobs = () =>
    db.job.findMany({
      where: { type: "github-scan", dedupeKey: `github-scan:${installationId}:*:force` },
      select: { id: true, payload: true, status: true },
    });
  const securityJobs = (org: string) =>
    db.job.findMany({
      where: { type: "security-scan", dedupeKey: `security-scan:org:${org}` },
      select: { id: true, payload: true, status: true },
    });

  beforeAll(async () => {
    testDb.client = db;
    orgId = (await db.org.create({ data: { name: `recheck-${suffix}` } })).id;
    scannerOrgId = (await db.org.create({ data: { name: `recheck-scanner-${suffix}` } })).id;
    emptyOrgId = (await db.org.create({ data: { name: `recheck-empty-${suffix}` } })).id;
    const installation = await withOrg(db, orgId).githubInstallation.create({
      data: { orgId, installationId, accountLogin: "acme", accountType: "Organization" },
    });
    await withOrg(db, orgId).repo.create({
      data: {
        orgId,
        name: `app-${suffix}`,
        source: "github",
        githubInstallationId: installation.id,
      },
    });
    await withOrg(db, scannerOrgId).repo.create({
      data: { orgId: scannerOrgId, name: `local-${suffix}`, source: "local" },
    });
  });

  afterAll(async () => {
    await db.job.deleteMany({ where: { dedupeKey: `github-scan:${installationId}:*:force` } });
    await db.job.deleteMany({
      where: { dedupeKey: { in: [orgId, scannerOrgId].map((o) => `security-scan:org:${o}`) } },
    });
    await db.org.deleteMany({ where: { id: { in: [orgId, scannerOrgId, emptyOrgId] } } });
    await db.$disconnect();
  });

  it("queues the App rescans and the org's security-scan, then waits ten minutes", async () => {
    session.orgId = orgId;
    expect(await recheckAction()).toEqual({ ok: true, checking: true, message: null });
    const queued = await jobs();
    expect(queued).toHaveLength(1);
    expect(queued[0].payload).toEqual({ installationId, force: true });
    const security = await securityJobs(orgId);
    expect(security.map((j) => j.payload)).toEqual([{ orgId, manual: true }]);
    expect(await recheckStatusAction()).toEqual({ checking: true });

    // Still in flight: the button keeps showing "Checking…", nothing new is queued.
    expect(await recheckAction()).toEqual({ ok: true, checking: true, message: null });
    expect(await jobs()).toHaveLength(1);
    expect(await securityJobs(orgId)).toHaveLength(1);

    // "Checking…" waits for both halves.
    await db.job.updateMany({ where: { id: queued[0].id }, data: { status: "succeeded" } });
    expect(await recheckStatusAction()).toEqual({ checking: true });
    await db.job.updateMany({ where: { id: security[0].id }, data: { status: "succeeded" } });
    expect(await recheckStatusAction()).toEqual({ checking: false });
    // A follow-up for repos the scan could not read yet still counts as checking.
    const followUp = await db.job.create({
      data: { type: "github-scan", dedupeKey: `github-scan:${installationId}:abc`, payload: {} },
    });
    expect(await recheckStatusAction()).toEqual({ checking: true });
    await db.job.delete({ where: { id: followUp.id } });
    expect(await recheckAction()).toMatchObject({
      ok: false,
      checking: false,
      message: expect.stringContaining("10 minutes"),
    });
    expect(await jobs()).toHaveLength(1);

    // After the interval it queues again.
    await db.org.update({
      where: { id: orgId },
      data: { recheckRequestedAt: new Date(Date.now() - 11 * 60_000) },
    });
    expect(await recheckAction()).toMatchObject({ ok: true, checking: true });
    expect(await jobs()).toHaveLength(2);
    expect(await securityJobs(orgId)).toHaveLength(2);
  });

  it("re-checks briff-scan-only orgs with the security-scan alone", async () => {
    session.orgId = scannerOrgId;
    expect(await recheckAction()).toEqual({ ok: true, checking: true, message: null });
    expect((await securityJobs(scannerOrgId)).map((j) => j.payload)).toEqual([
      { orgId: scannerOrgId, manual: true },
    ]);
    expect(await recheckStatusAction()).toEqual({ checking: true });
    expect(await jobs()).toHaveLength(2);
  });

  it("queues nothing for an org without repos", async () => {
    session.orgId = emptyOrgId;
    expect(await recheckAction()).toMatchObject({ ok: false, checking: false });
    expect(await recheckStatusAction()).toEqual({ checking: false });
    expect(await securityJobs(emptyOrgId)).toHaveLength(0);
  });
});
