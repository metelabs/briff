import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";

import { recordFeedback } from "./feedback";

// Runs only when TEST_DATABASE_URL points at a migrated, disposable database.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("recordFeedback against Postgres", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  let orgA = "";
  let orgB = "";
  let orgC = "";
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
    orgC = (await db.org.create({ data: { name: `c-${suffix}` } })).id;
    for (const orgId of [orgA, orgC]) {
      await withOrg(db, orgId).orgMember.create({ data: { orgId, userId } });
    }
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
    for (const orgId of [orgA, orgC]) {
      await withOrg(db, orgId).itemMatch.create({
        data: { orgId, itemId, packageId, reason: "release", score: 1 },
      });
    }
  });

  afterAll(async () => {
    await db.org.deleteMany({ where: { id: { in: [orgA, orgB, orgC] } } });
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

  it("keeps one rating per org when the same user rates the same item in two orgs", async () => {
    const rows = (orgId: string) =>
      withOrg(db, orgId).feedback.findMany({ where: { userId, itemId } });
    const weight = async (orgId: string) =>
      (
        ((await withOrg(db, orgId).interestProfile.findFirst())?.weights ?? {}) as Record<
          string,
          number
        >
      )[`package:pkg-${suffix}`];

    expect(
      await recordFeedback(db, { orgId: orgA, userId, itemId, kind: "up", toggle: false })
    ).toEqual({ ok: true, kind: "up" });
    expect(
      await recordFeedback(db, { orgId: orgC, userId, itemId, kind: "less", toggle: false })
    ).toEqual({ ok: true, kind: "less" });
    expect((await rows(orgA)).map((f) => f.kind)).toEqual(["up"]);
    expect((await rows(orgC)).map((f) => f.kind)).toEqual(["less"]);
    expect(await weight(orgA)).toBe(1);
    expect(await weight(orgC)).toBe(-1);

    // Clearing it in one org leaves the other org's rating and weights alone.
    expect(
      await recordFeedback(db, { orgId: orgC, userId, itemId, kind: "less", toggle: true })
    ).toEqual({ ok: true, kind: null });
    expect(await rows(orgC)).toHaveLength(0);
    expect((await rows(orgA)).map((f) => f.kind)).toEqual(["up"]);
    expect(await weight(orgA)).toBe(1);
  });
});
