import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { loadOrgCapacity } from "./org-capacity";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("organisation capacity notice", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const ids: string[] = [];
  afterAll(async () => {
    await db.org.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  });
  it("shows configured limits and counts only this organisation's repos and streams", async () => {
    for (const suffix of ["a", "b"]) {
      const org = await db.org.create({
        data: { name: `Acme capacity ${suffix}`, repoLimit: 7, streamLimit: 3 },
      });
      ids.push(org.id);
      const scoped = withOrg(db, org.id);
      await scoped.repo.create({ data: { orgId: org.id, name: "acme/web", source: "local" } });
      await scoped.bulletinStream.create({
        data: { orgId: org.id, name: "Weekly", slug: "weekly" },
      });
    }
    await expect(loadOrgCapacity(db, ids[0])).resolves.toEqual({
      repos: 1,
      repoLimit: 7,
      streams: 1,
      streamLimit: 3,
    });
  });
});
