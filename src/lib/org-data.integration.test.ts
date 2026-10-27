import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { createOrgForUser } from "@/lib/org";

import { deleteOrg, orgExportStream } from "./org-data";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("org data export and deletion against Postgres", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  const users: string[] = [];
  const orgs: string[] = [];
  let packageId = "";
  let advisoryId = "";
  let itemId = "";
  let sourceId = "";

  async function user(tag: string): Promise<string> {
    const id = `u-${tag}-${suffix}`;
    await db.user.create({
      data: { id, name: `User ${tag}`, email: `${tag}-${suffix}@example.com` },
    });
    await db.account.create({
      data: {
        id: `a-${tag}-${suffix}`,
        accountId: id,
        providerId: "credential",
        userId: id,
        password: "hash:secret",
      },
    });
    await db.session.create({
      data: {
        id: `s-${tag}-${suffix}`,
        token: `tok-${tag}-${suffix}`,
        userId: id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    users.push(id);
    return id;
  }

  /** An org with one row in every tenant table. */
  async function populatedOrg(userId: string, name: string, feedback = true): Promise<string> {
    const orgId = await createOrgForUser(db, { name, userId });
    orgs.push(orgId);
    const scoped = withOrg(db, orgId);
    const repo = await scoped.repo.create({
      data: { orgId, name: `${name}/app`, source: "github", included: true },
    });
    const stream = await scoped.bulletinStream.findFirstOrThrow({ select: { id: true } });
    await scoped.streamRepo.create({ data: { orgId, streamId: stream.id, repoId: repo.id } });
    await scoped.dependency.create({
      data: { orgId, repoId: repo.id, packageId, installedVersion: "1.0.0", direct: true },
    });
    await scoped.repoRuntime.create({
      data: { orgId, repoId: repo.id, name: "node", version: "22", source: ".nvmrc" },
    });
    await scoped.itemMatch.create({
      data: { orgId, itemId, packageId, repoIds: [repo.id], reason: "release:x", score: 1 },
    });
    await scoped.alert.create({ data: { orgId, advisoryId, repoId: repo.id } });
    await scoped.baseImageAlert.create({
      data: {
        orgId,
        repoId: repo.id,
        image: "debian:12",
        ecosystem: "Debian:12",
        osvId: "CVE-ACME",
        packages: ["openssl"],
        action: "rebuild on the latest debian:12 tag",
        modifiedAt: new Date(),
      },
    });
    const bulletin = await scoped.bulletin.create({
      data: {
        orgId,
        streamId: stream.id,
        weekStart: new Date("2026-10-19"),
        model: "m",
        promptVersion: "p",
        summary: `summary ${name}`,
        inputHash: "h",
      },
    });
    await scoped.bulletinItem.create({
      data: {
        orgId,
        bulletinId: bulletin.id,
        itemId,
        bucket: "security",
        order: 0,
        line: `line ${name}`,
      },
    });
    // Feedback is unique per (user, item) across orgs.
    if (feedback) await scoped.feedback.create({ data: { orgId, userId, itemId, kind: "up" } });
    await scoped.deadline.create({
      data: { orgId, itemId, what: "do it", dueAt: new Date("2026-11-01") },
    });
    await scoped.scanToken.create({
      data: {
        orgId,
        name: "ci",
        tokenHash: `hash-${name}-${suffix}`,
        prefix: "brf_abcd",
        createdByUserId: userId,
      },
    });
    await scoped.interestProfile.updateMany({ data: { text: `profile ${name}` } });
    await scoped.githubInstallation.create({
      data: {
        orgId,
        installationId: `${Date.now()}${Math.floor(Math.random() * 1e6)}`,
        accountLogin: name,
        accountType: "User",
      },
    });
    return orgId;
  }

  async function tenantCounts(orgId: string): Promise<Record<string, number>> {
    const s = withOrg(db, orgId);
    return {
      orgMember: await s.orgMember.count(),
      repo: await s.repo.count(),
      dependency: await s.dependency.count(),
      repoRuntime: await s.repoRuntime.count(),
      itemMatch: await s.itemMatch.count(),
      alert: await s.alert.count(),
      bulletin: await s.bulletin.count(),
      bulletinItem: await s.bulletinItem.count(),
      feedback: await s.feedback.count(),
      interestProfile: await s.interestProfile.count(),
      deadline: await s.deadline.count(),
      bulletinStream: await s.bulletinStream.count(),
      streamRepo: await s.streamRepo.count(),
      scanToken: await s.scanToken.count(),
      githubInstallation: await s.githubInstallation.count(),
    };
  }

  beforeAll(async () => {
    packageId = (
      await db.package.create({ data: { ecosystem: "npm", name: `export-pkg-${suffix}` } })
    ).id;
    advisoryId = (
      await db.advisory.create({
        data: { osvId: `GHSA-${suffix}`, packageId, affected: [], severity: "high" },
      })
    ).id;
    sourceId = (
      await db.source.create({
        data: { kind: "rss", url: `https://example.com/${suffix}.xml`, name: "Feed" },
      })
    ).id;
    itemId = (
      await db.item.create({
        data: {
          sourceId,
          title: "An item",
          url: `https://example.com/${suffix}`,
          contentHash: `h-${suffix}`,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await db.org.deleteMany({ where: { id: { in: orgs } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.source.deleteMany({ where: { id: sourceId } });
    await db.package.deleteMany({ where: { id: packageId } });
    await db.$disconnect();
  });

  it("exports the org's own data, without secrets or other orgs", async () => {
    const alice = await user("alice");
    const bob = await user("bob");
    const mine = await populatedOrg(alice, `mine-${suffix}`);
    await populatedOrg(bob, `other-${suffix}`);

    const text = await new Response(
      orgExportStream(db, mine, new Date("2026-10-24T00:00:00Z"))
    ).text();
    const data = JSON.parse(text) as Record<string, unknown[]> & { org: { name: string } };
    expect(data.format).toBe("briff-export-v1");
    expect(data.org.name).toBe(`mine-${suffix}`);
    for (const key of [
      "repos",
      "dependencies",
      "runtimes",
      "streams",
      "bulletins",
      "bulletinItems",
      "alerts",
      "baseImageAlerts",
      "feedback",
      "deadlines",
      "scanTokens",
      "githubInstallations",
      "members",
    ]) {
      expect(data[key], key).toHaveLength(1);
    }
    expect(data.dependencies[0]).toMatchObject({
      package: `export-pkg-${suffix}`,
      installedVersion: "1.0.0",
    });
    expect(data.alerts[0]).toMatchObject({
      advisory: { osvId: `GHSA-${suffix}`, package: `export-pkg-${suffix}` },
    });
    expect(data.profile).toMatchObject({ text: `profile mine-${suffix}` });
    expect(text).not.toContain(`other-${suffix}`);
    expect(text).not.toContain("tokenHash");
    expect(text).not.toContain(`hash-mine-${suffix}`);
    expect(text).not.toContain("hash:secret");
    expect(text).not.toContain(`tok-alice-${suffix}`);
    expect(text).not.toContain(bob);
  });

  it("deletes the org with everything attached and the user who has no other org", async () => {
    const carol = await user("carol");
    const orgId = await populatedOrg(carol, `carol-${suffix}`);
    const before = await tenantCounts(orgId);
    expect(Object.values(before).every((n) => n > 0)).toBe(true);
    await db.job.create({
      data: { type: "bulletin-preview", dedupeKey: `p-${suffix}`, payload: { orgId } },
    });

    expect(await deleteOrg(db, { orgId, userId: carol, confirmName: "wrong" })).toEqual({
      ok: false,
      reason: "name-mismatch",
    });
    expect(
      await deleteOrg(db, { orgId, userId: carol, confirmName: `  carol-${suffix} ` })
    ).toEqual({ ok: true, userDeleted: true });

    expect(await db.org.count({ where: { id: orgId } })).toBe(0);
    expect(Object.values(await tenantCounts(orgId)).every((n) => n === 0)).toBe(true);
    expect(await db.user.count({ where: { id: carol } })).toBe(0);
    expect(await db.session.count({ where: { userId: carol } })).toBe(0);
    expect(await db.account.count({ where: { userId: carol } })).toBe(0);
    expect(await db.job.count({ where: { dedupeKey: `p-${suffix}` } })).toBe(0);
    // Global catalog rows stay.
    expect(await db.item.count({ where: { id: itemId } })).toBe(1);
    expect(await db.advisory.count({ where: { id: advisoryId } })).toBe(1);
  });

  it("refuses to delete the instance admin's account while other accounts exist", async () => {
    // Make a fresh user the oldest one, i.e. the instance admin.
    const root = `u-root-${suffix}`;
    await db.user.create({
      data: { id: root, name: "Root", email: `root-${suffix}@example.com`, createdAt: new Date(0) },
    });
    users.push(root);
    const orgId = await populatedOrg(root, `root-${suffix}`, false);
    expect(await deleteOrg(db, { orgId, userId: root, confirmName: `root-${suffix}` })).toEqual({
      ok: false,
      reason: "instance-admin",
    });
    expect(await db.org.count({ where: { id: orgId } })).toBe(1);
  });

  it("keeps a user who belongs to another org, and only owners may delete", async () => {
    const dave = await user("dave");
    const erin = await user("erin");
    const first = await populatedOrg(dave, `dave-${suffix}`);
    const second = await populatedOrg(dave, `dave2-${suffix}`, false);
    await withOrg(db, first).orgMember.create({
      data: { orgId: first, userId: erin, role: "member" },
    });

    expect(
      await deleteOrg(db, { orgId: first, userId: erin, confirmName: `dave-${suffix}` })
    ).toEqual({ ok: false, reason: "not-owner" });
    expect(
      await deleteOrg(db, { orgId: first, userId: dave, confirmName: `dave-${suffix}` })
    ).toEqual({ ok: true, userDeleted: false });
    expect(await db.user.count({ where: { id: { in: [dave, erin] } } })).toBe(2);
    expect(await db.org.count({ where: { id: second } })).toBe(1);
    expect((await tenantCounts(second)).repo).toBe(1);
  });
});
