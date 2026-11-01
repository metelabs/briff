import { afterAll, describe, expect, it } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";

import { loadOrgDirectory } from "./org-directory";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("loadOrgDirectory against Postgres", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  const orgIds: string[] = [];
  const userIds: string[] = [];

  afterAll(async () => {
    await db.org.deleteMany({ where: { id: { in: orgIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  });

  it("counts each org's members, repos and streams and names its first owner", async () => {
    const user = async (name: string) => {
      const id = `${name}-${suffix}`;
      await db.user.create({ data: { id, name, email: `${name}-${suffix}@example.com` } });
      userIds.push(id);
      return id;
    };
    const [ann, ben, cy] = [await user("ann"), await user("ben"), await user("cy")];
    const busy = (
      await db.org.create({ data: { name: `busy-${suffix}`, plan: "pro", repoLimit: 60 } })
    ).id;
    const quiet = (await db.org.create({ data: { name: `quiet-${suffix}` } })).id;
    orgIds.push(busy, quiet);
    const scoped = withOrg(db, busy);
    await scoped.orgMember.create({ data: { orgId: busy, userId: ann } });
    await scoped.orgMember.create({ data: { orgId: busy, userId: ben, role: "member" } });
    for (const name of ["a", "b"])
      await scoped.repo.create({
        data: { orgId: busy, name: `${name}-${suffix}`, source: "github" },
      });
    await scoped.bulletinStream.create({
      data: { orgId: busy, name: "Weekly", slug: `w-${suffix}` },
    });
    await withOrg(db, quiet).orgMember.create({ data: { orgId: quiet, userId: cy } });

    const rows = await loadOrgDirectory(db, { cloud: true });
    expect(rows.find((r) => r.id === busy)).toMatchObject({
      ownerEmail: `ann-${suffix}@example.com`,
      members: 2,
      repos: 2,
      streams: 1,
      plan: "pro",
      repoOverride: 60,
      streamOverride: null,
      repoLimit: 60,
      streamLimit: 10,
    });
    expect(rows.find((r) => r.id === quiet)).toMatchObject({
      ownerEmail: `cy-${suffix}@example.com`,
      members: 1,
      repos: 0,
      streams: 0,
      plan: "free",
      repoLimit: 10,
      streamLimit: 2,
    });
    const selfHosted = await loadOrgDirectory(db, { cloud: false });
    expect(selfHosted.find((r) => r.id === busy)).toMatchObject({
      repoLimit: null,
      streamLimit: null,
    });
  });
});
