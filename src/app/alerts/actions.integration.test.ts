import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";

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

const { markBacklogReviewedAction, markPackageReviewedAction } = await import("./actions");

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
