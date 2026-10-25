import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";

import { hasUnseenAlerts, markAlertsSeen, markOnboarded, shouldOnboard } from "./member-state";

// Runs only when TEST_DATABASE_URL points at a migrated, disposable database.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("member state", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  const userId = `member-user-${suffix}`;
  let orgId = "";
  let repoId = "";
  let packageId = "";
  const advisoryIds: string[] = [];

  async function alert(kind: "new" | "backlog", createdAt: Date): Promise<void> {
    const advisory = await db.advisory.create({
      data: { osvId: `GHSA-member-${suffix}-${advisoryIds.length}`, packageId, affected: [] },
    });
    advisoryIds.push(advisory.id);
    await withOrg(db, orgId).alert.create({
      data: { orgId, advisoryId: advisory.id, repoId, kind, createdAt },
    });
  }

  beforeAll(async () => {
    await db.user.create({ data: { id: userId, name: "Member", email: `${userId}@example.com` } });
    orgId = (await db.org.create({ data: { name: `member-${suffix}` } })).id;
    const tenant = withOrg(db, orgId);
    await tenant.orgMember.create({ data: { orgId, userId } });
    repoId = (
      await tenant.repo.create({ data: { orgId, name: `repo-${suffix}`, source: "local" } })
    ).id;
    packageId = (
      await db.package.create({ data: { ecosystem: "npm", name: `member-pkg-${suffix}` } })
    ).id;
  });

  afterAll(async () => {
    await db.org.deleteMany({ where: { id: orgId } });
    await db.advisory.deleteMany({ where: { id: { in: advisoryIds } } });
    await db.package.deleteMany({ where: { id: packageId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  });

  it("lights the dot for new alerts until /alerts is visited, then for newer ones only", async () => {
    await alert("backlog", new Date("2026-10-20T08:00:00Z"));
    expect(await hasUnseenAlerts(db, orgId, userId, {})).toBe(false);

    await alert("new", new Date("2026-10-21T08:00:00Z"));
    expect(await hasUnseenAlerts(db, orgId, userId, {})).toBe(true);
    expect(await hasUnseenAlerts(db, orgId, userId, { id: "another-repo" })).toBe(false);

    await markAlertsSeen(db, orgId, userId, new Date("2026-10-22T08:00:00Z"));
    expect(await hasUnseenAlerts(db, orgId, userId, {})).toBe(false);

    await alert("new", new Date("2026-10-23T08:00:00Z"));
    expect(await hasUnseenAlerts(db, orgId, userId, {})).toBe(true);
  });

  it("shows onboarding once: skipping it or a repo in a stream ends it", async () => {
    expect(await shouldOnboard(db, orgId, userId)).toBe(true);
    await markOnboarded(db, orgId, userId, new Date("2026-10-22T09:00:00Z"));
    expect(await shouldOnboard(db, orgId, userId)).toBe(false);
    await markOnboarded(db, orgId, userId, new Date("2026-10-24T09:00:00Z"));
    const member = await withOrg(db, orgId).orgMember.findFirstOrThrow({ where: { userId } });
    expect(member.onboardedAt?.toISOString()).toBe("2026-10-22T09:00:00.000Z");

    await withOrg(db, orgId).orgMember.updateMany({ data: { onboardedAt: null } });
    await withOrg(db, orgId).repo.updateMany({ where: { id: repoId }, data: { included: true } });
    expect(await shouldOnboard(db, orgId, userId)).toBe(false);
  });
});
