import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { resetEnvCache } from "@/lib/env";
import { loadOrgCapacity } from "./org-capacity";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("organisation capacity notice", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const ids: string[] = [];
  afterAll(async () => {
    await db.org.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
    vi.unstubAllEnvs();
    resetEnvCache();
  });
  it("shows the plan's limits and counts only this organisation's repos, streams and members", async () => {
    vi.stubEnv("BRIFF_CLOUD", "true");
    resetEnvCache();
    for (const suffix of ["a", "b"]) {
      const org = await db.org.create({
        data: { name: `Acme capacity ${suffix}`, plan: "pro", repoLimit: 70 },
      });
      ids.push(org.id);
      const scoped = withOrg(db, org.id);
      await scoped.repo.create({ data: { orgId: org.id, name: "acme/web", source: "local" } });
      await scoped.bulletinStream.create({
        data: { orgId: org.id, name: "Weekly", slug: "weekly" },
      });
    }
    await expect(loadOrgCapacity(db, ids[0])).resolves.toEqual({
      cloud: true,
      plan: "pro",
      repos: 1,
      repoLimit: 70,
      streams: 1,
      streamLimit: 10,
      members: 0,
      memberLimit: 3,
    });
    vi.stubEnv("BRIFF_CLOUD", "false");
    resetEnvCache();
    await expect(loadOrgCapacity(db, ids[0])).resolves.toMatchObject({
      cloud: false,
      plan: "unlimited",
      repoLimit: null,
      streamLimit: null,
      memberLimit: null,
    });
  });
});
