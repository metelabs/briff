import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { ECOSYSTEM_SOURCES } from "@/sources/curated";
import { loadOrgStacks } from "./stack";
import { matchItem } from "./matcher";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("curated scope matching", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const orgIds: string[] = [];
  const packageIds: string[] = [];
  afterAll(async () => {
    await db.org.deleteMany({ where: { id: { in: orgIds } } });
    await db.package.deleteMany({ where: { id: { in: packageIds } } });
    await db.$disconnect();
  });
  it("limits ecosystem and platform feeds to relevant repos even when text mentions another stack", async () => {
    const org = await db.org.create({ data: { name: "acme-feeds" } });
    orgIds.push(org.id);
    const scoped = withOrg(db, org.id);
    const python = await scoped.repo.create({
      data: { orgId: org.id, name: "acme/python", source: "local" },
    });
    const web = await scoped.repo.create({
      data: { orgId: org.id, name: "acme/web", source: "github" },
    });
    for (const [repoId, ecosystem] of [
      [python.id, "PyPI"],
      [web.id, "npm"],
    ]) {
      const pkg = await db.package.create({
        data: { name: `acme-${crypto.randomUUID()}`, ecosystem },
      });
      packageIds.push(pkg.id);
      await scoped.dependency.create({
        data: { orgId: org.id, repoId, packageId: pkg.id, installedVersion: "1.0.0", direct: true },
      });
    }
    await scoped.repoRuntime.create({
      data: {
        orgId: org.id,
        repoId: web.id,
        name: "node",
        version: "22",
        normalized: "22",
        source: "Dockerfile",
        image: "node:22",
      },
    });
    const [stack] = await loadOrgStacks(db, [org.id]);
    const matches = (name: string) => {
      const feed = ECOSYSTEM_SOURCES.find((f) => f.name === name);
      if (!feed) throw new Error("Missing curated feed");
      return matchItem(
        {
          title: "next React security release",
          rawText: "An unrelated package mention must not bypass feed scope.",
        },
        { kind: feed.kind, url: feed.url, serviceKey: null, runtime: null, traits: feed.traits },
        stack
      );
    };
    expect(matches("Django weblog")?.repoIds).toEqual([python.id]);
    expect(matches("Docker blog")?.repoIds).toEqual([web.id]);
    expect(matches("GitHub changelog")?.repoIds).toEqual([web.id]);
    expect(matches("Laravel blog")).toBeNull();
    expect(matches("Elixir blog")).toBeNull();
    const releaseSource = ECOSYSTEM_SOURCES.find((s) => s.name === "FastAPI releases");
    if (!releaseSource) throw new Error("Missing release feed");
    const tracked = await db.package.update({
      where: { id: packageIds[0] },
      data: { releaseFeedUrl: releaseSource.url },
    });
    const [refreshed] = await loadOrgStacks(db, [org.id]);
    const release = matchItem(
      { title: "Acme 1.1.0", rawText: "Release notes" },
      {
        kind: "rss",
        url: releaseSource.url,
        serviceKey: null,
        runtime: null,
        traits: releaseSource.traits,
      },
      refreshed
    );
    expect(release?.reason).toBe(`release:${tracked.name}`);
    expect(release?.packageId).toBe(tracked.id);
    expect(release?.repoIds).toEqual([python.id]);
  });
});
