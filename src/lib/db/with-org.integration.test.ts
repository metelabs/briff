import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

import { OrgScopeError, withOrg } from "./with-org";

// Runs only when TEST_DATABASE_URL points at a migrated, disposable database.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("withOrg against Postgres", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  let orgA = "";
  let orgB = "";

  beforeAll(async () => {
    orgA = (await db.org.create({ data: { name: `a-${suffix}` } })).id;
    orgB = (await db.org.create({ data: { name: `b-${suffix}` } })).id;
    await db.repo.create({ data: { orgId: orgB, name: `b-repo-${suffix}`, source: "local" } });
  });

  afterAll(async () => {
    await db.org.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.$disconnect();
  });

  it("only ever sees and writes its own org's rows", async () => {
    const a = withOrg(db, orgA);
    const created = await a.repo.create({
      data: { orgId: orgA, name: `a-repo-${suffix}`, source: "local" },
    });
    expect(created.orgId).toBe(orgA);

    const visible = await a.repo.findMany();
    expect(visible.map((r) => r.orgId)).toEqual([orgA]);

    const foreign = await db.repo.findFirstOrThrow({ where: { orgId: orgB } });
    expect(await a.repo.findUnique({ where: { id: foreign.id } })).toBeNull();
    expect(
      (await a.repo.updateMany({ where: { id: foreign.id }, data: { included: true } })).count
    ).toBe(0);
    await expect(a.repo.findMany({ where: { orgId: orgB } })).rejects.toBeInstanceOf(OrgScopeError);
    await expect(
      a.repo.create({ data: { orgId: orgB, name: `x-${suffix}`, source: "local" } })
    ).rejects.toBeInstanceOf(OrgScopeError);
  });
});
