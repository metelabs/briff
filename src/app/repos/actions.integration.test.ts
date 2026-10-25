import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";

// Runs only when TEST_DATABASE_URL points at a migrated, disposable database.
const url = process.env.TEST_DATABASE_URL;

const session = vi.hoisted(() => ({ orgId: "" }));
const revalidated = vi.hoisted(() => [] as string[]);
const testDb = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/auth/session", () => ({
  requireOrgContext: async () => ({ userId: "u", email: "u@example.com", name: "u", ...session }),
}));
vi.mock("@/lib/db/client", () => ({ getDb: () => testDb.client }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidated.push(path) }));

const { removeRepoAction } = await import("./actions");

describe.skipIf(!url)("removeRepoAction against Postgres", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  testDb.client = db;
  const suffix = Date.now().toString(36);
  let orgId = "";
  let otherOrgId = "";

  beforeAll(async () => {
    orgId = (await db.org.create({ data: { name: `rm-${suffix}` } })).id;
    otherOrgId = (await db.org.create({ data: { name: `rm-other-${suffix}` } })).id;
  });

  afterAll(async () => {
    await db.org.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
    await db.package.deleteMany({ where: { name: `rm-pkg-${suffix}` } });
    await db.source.deleteMany({ where: { url: `https://example.com/rm-${suffix}.xml` } });
    await db.$disconnect();
  });

  it("deletes the repo with its rows, keeps match history and other orgs' repos", async () => {
    const scoped = withOrg(db, orgId);
    const [gone, kept] = await Promise.all(
      ["gone", "kept"].map((n) =>
        scoped.repo.create({
          data: { orgId, name: `${n}-${suffix}`, source: "local", included: true },
        })
      )
    );
    const foreign = await withOrg(db, otherOrgId).repo.create({
      data: { orgId: otherOrgId, name: `gone-${suffix}`, source: "local" },
    });
    const pkg = await db.package.create({ data: { ecosystem: "npm", name: `rm-pkg-${suffix}` } });
    const advisory = await db.advisory.create({
      data: { osvId: `GHSA-rm-${suffix}`, packageId: pkg.id, affected: [] },
    });
    for (const repoId of [gone.id, kept.id]) {
      await scoped.dependency.create({
        data: { orgId, repoId, packageId: pkg.id, installedVersion: "1.0.0", direct: true },
      });
      await scoped.repoRuntime.create({
        data: { orgId, repoId, name: "node", version: "22", normalized: "22", source: ".nvmrc" },
      });
      await scoped.alert.create({ data: { orgId, advisoryId: advisory.id, repoId } });
    }
    const stream = await scoped.bulletinStream.create({
      data: { orgId, name: "Work", slug: `work-${suffix}` },
    });
    await scoped.streamRepo.createMany({
      data: [gone.id, kept.id].map((repoId) => ({ orgId, streamId: stream.id, repoId })),
    });
    const source = await db.source.create({
      data: {
        kind: "rss",
        url: `https://example.com/rm-${suffix}.xml`,
        name: "rm",
        enabled: false,
      },
    });
    const item = await db.item.create({
      data: { sourceId: source.id, title: "t", url: "https://example.com/t", contentHash: suffix },
    });
    const match = await scoped.itemMatch.create({
      data: {
        orgId,
        itemId: item.id,
        repoIds: [gone.id, kept.id],
        urgentRepoIds: [gone.id],
        urgentAt: new Date(),
        reason: "runtime:node",
        score: 1,
      },
    });

    session.orgId = orgId;
    revalidated.length = 0;
    expect(await removeRepoAction(gone.id)).toEqual({
      ok: true,
      message: `Removed gone-${suffix}.`,
    });
    expect(revalidated).toEqual(["/", "/repos", "/alerts", "/stack", "/streams"]);

    expect(await scoped.repo.findMany({ select: { id: true } })).toEqual([{ id: kept.id }]);
    for (const where of [{ repoId: gone.id }, { repoId: kept.id }]) {
      const expected = where.repoId === kept.id ? 1 : 0;
      expect(await scoped.dependency.count({ where })).toBe(expected);
      expect(await scoped.repoRuntime.count({ where })).toBe(expected);
      expect(await scoped.alert.count({ where })).toBe(expected);
      expect(await scoped.streamRepo.count({ where })).toBe(expected);
    }
    // History stays: readers drop ids of repos that are not (or no longer) included.
    const after = await scoped.itemMatch.findUniqueOrThrow({ where: { id: match.id } });
    expect(after.repoIds).toEqual([gone.id, kept.id]);
    expect(after.urgentRepoIds).toEqual([gone.id]);
    expect(await withOrg(db, otherOrgId).repo.count({ where: { id: foreign.id } })).toBe(1);

    expect(await removeRepoAction(gone.id)).toEqual({
      ok: false,
      message: "This repo was already removed.",
    });
  });

  it("does not remove another org's repo", async () => {
    const foreign = await withOrg(db, otherOrgId).repo.create({
      data: { orgId: otherOrgId, name: `foreign-${suffix}`, source: "github" },
    });
    session.orgId = orgId;
    revalidated.length = 0;
    expect((await removeRepoAction(foreign.id)).ok).toBe(false);
    expect(revalidated).toEqual([]);
    expect(await withOrg(db, otherOrgId).repo.count({ where: { id: foreign.id } })).toBe(1);
  });
});
