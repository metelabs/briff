import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";

import { createOrgForUser } from "./org";
import { setRepoInStream, setStreamRepos } from "./streams";

// Runs only when TEST_DATABASE_URL points at a migrated, disposable database.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("stream membership against Postgres", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  let orgId = "";
  let otherOrgId = "";

  beforeAll(async () => {
    orgId = (await db.org.create({ data: { name: `s-${suffix}` } })).id;
    otherOrgId = (await db.org.create({ data: { name: `t-${suffix}` } })).id;
  });

  it("creates a new user's org with the default stream in one go", async () => {
    const user = await db.user.create({
      data: { id: `u-${suffix}`, name: "u", email: `u-${suffix}@example.com` },
    });
    const id = await createOrgForUser(db, { name: "u", userId: user.id });
    const streams = await withOrg(db, id).bulletinStream.findMany({ select: { slug: true } });
    expect(streams).toEqual([{ slug: "weekly" }]);
    await db.org.delete({ where: { id } });
    await db.user.delete({ where: { id: user.id } });
  });

  afterAll(async () => {
    await db.org.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
    await db.$disconnect();
  });

  it("keeps Repo.included equal to 'in at least one stream' and ignores foreign repos", async () => {
    const scoped = withOrg(db, orgId);
    const [a, b] = await Promise.all(
      ["a", "b"].map((n) =>
        scoped.repo.create({ data: { orgId, name: `${n}-${suffix}`, source: "local" } })
      )
    );
    const foreign = await db.repo.create({
      data: { orgId: otherOrgId, name: `f-${suffix}`, source: "local" },
    });
    const work = await scoped.bulletinStream.create({
      data: { orgId, name: "Work", slug: "work" },
    });
    const personal = await scoped.bulletinStream.create({
      data: { orgId, name: "Personal", slug: "personal" },
    });

    expect(await setStreamRepos(scoped, orgId, work.id, [a.id, b.id, foreign.id])).toBe(true);
    expect(await scoped.streamRepo.count({ where: { streamId: work.id } })).toBe(2);
    await setRepoInStream(scoped, orgId, personal.id, a.id, true);
    await setStreamRepos(scoped, orgId, work.id, [a.id]);

    const included = async () =>
      Object.fromEntries(
        (await scoped.repo.findMany({ select: { id: true, included: true } })).map((r) => [
          r.id,
          r.included,
        ])
      );
    expect(await included()).toEqual({ [a.id]: true, [b.id]: false });

    const bulletin = await scoped.bulletin.create({
      data: {
        orgId,
        streamId: work.id,
        weekStart: new Date("2026-10-19T00:00:00Z"),
        model: "m",
        promptVersion: "p",
        summary: "",
        inputHash: "h",
      },
    });
    await scoped.bulletinStream.deleteMany({ where: { id: work.id } });
    // Deleting a stream keeps its bulletins, without a stream.
    expect((await scoped.bulletin.findFirstOrThrow({ where: { id: bulletin.id } })).streamId).toBe(
      null
    );
    await setRepoInStream(scoped, orgId, personal.id, a.id, false);
    expect((await included())[a.id]).toBe(false);
    expect((await db.repo.findUniqueOrThrow({ where: { id: foreign.id } })).included).toBe(false);
  });
});
