import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

import { recordFeedback } from "./feedback";

// Runs only when TEST_DATABASE_URL points at a migrated, disposable database.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("recordFeedback against Postgres", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  let orgA = "";
  let orgB = "";
  let userId = "";
  let itemId = "";
  let sourceId = "";
  let packageId = "";

  beforeAll(async () => {
    orgA = (await db.org.create({ data: { name: `a-${suffix}` } })).id;
    orgB = (await db.org.create({ data: { name: `b-${suffix}` } })).id;
    userId = (
      await db.user.create({
        data: { id: `u-${suffix}`, name: "u", email: `u-${suffix}@example.com` },
      })
    ).id;
    await db.orgMember.create({ data: { orgId: orgA, userId } });
    packageId = (await db.package.create({ data: { ecosystem: "npm", name: `pkg-${suffix}` } })).id;
    sourceId = (
      await db.source.create({
        data: { kind: "rss", url: `https://example.com/${suffix}`, name: "Feed" },
      })
    ).id;
    itemId = (
      await db.item.create({
        data: { sourceId, title: "t", url: "https://example.com/i", contentHash: `h-${suffix}` },
      })
    ).id;
    await db.itemMatch.create({
      data: { orgId: orgA, itemId, packageId, reason: "release", score: 1 },
    });
  });

  afterAll(async () => {
    await db.org.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.source.deleteMany({ where: { id: sourceId } });
    await db.package.deleteMany({ where: { id: packageId } });
    await db.$disconnect();
  });

  it("stores feedback, moves weights, toggles off, and refuses items outside the org", async () => {
    const pkgKey = `package:pkg-${suffix}`;
    const weights = async () =>
      ((await db.interestProfile.findUnique({ where: { orgId: orgA } }))?.weights ?? {}) as Record<
        string,
        number
      >;

    expect(
      await recordFeedback(db, { orgId: orgA, userId, itemId, kind: "up", toggle: true })
    ).toEqual({ ok: true, kind: "up" });
    expect((await weights())[pkgKey]).toBe(1);

    expect(
      await recordFeedback(db, { orgId: orgA, userId, itemId, kind: "less", toggle: true })
    ).toEqual({ ok: true, kind: "less" });
    expect((await weights())[pkgKey]).toBe(-1);
    expect((await weights())["source:Feed"]).toBe(-1);

    expect(
      await recordFeedback(db, { orgId: orgA, userId, itemId, kind: "less", toggle: true })
    ).toEqual({ ok: true, kind: null });
    expect(await weights()).toEqual({});
    expect(await db.feedback.count({ where: { userId } })).toBe(0);

    expect(
      (await recordFeedback(db, { orgId: orgB, userId, itemId, kind: "up", toggle: false })).ok
    ).toBe(false);
  });
});
