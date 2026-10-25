import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

import { claimNextJob, enqueueJob, failJob, releaseStaleJobs, touchJob } from "./queue";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("job queue against Postgres", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const key = `test-${Date.now().toString(36)}`;

  beforeEach(async () => {
    await db.job.deleteMany({ where: { dedupeKey: { startsWith: key } } });
  });

  afterAll(async () => {
    await db.job.deleteMany({ where: { dedupeKey: { startsWith: key } } });
    await db.$disconnect();
  });

  it("does not create a second pending job for the same key, even concurrently", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => enqueueJob(db, "collect-sources", { dedupeKey: key }))
    );
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
  });

  it("claims each due job once and backs off on failure", async () => {
    const { id } = await enqueueJob(db, "refresh-packages", {
      dedupeKey: `${key}-claim`,
      runAfter: new Date(Date.now() - 1000),
      maxAttempts: 2,
    });
    // Other test files leave due jobs behind (refresh-packages from ingests); claim until ours
    // comes up, two workers at a time.
    let claimed: NonNullable<Awaited<ReturnType<typeof claimNextJob>>>[] = [];
    for (let i = 0; i < 100 && claimed.length === 0; i++) {
      const [a, b] = await Promise.all([claimNextJob(db, "w1"), claimNextJob(db, "w2")]);
      if (!a && !b) break;
      claimed = [a, b].flatMap((j) => (j?.id === id ? [j] : []));
    }
    expect(claimed).toHaveLength(1);

    const job = claimed[0]!;
    expect(job.attempts).toBe(1);
    expect(await failJob(db, job, "boom")).toBe("retry");
    const retried = await db.job.findUniqueOrThrow({ where: { id } });
    expect(retried.status).toBe("pending");
    expect(retried.runAfter.getTime()).toBeGreaterThan(Date.now());

    // Not held any more (back to pending): nothing is written.
    expect(await failJob(db, { ...job, attempts: 2 }, "late")).toBe("lost");
    expect((await db.job.findUniqueOrThrow({ where: { id } })).lastError).toBe("boom");
    await db.job.update({
      where: { id },
      data: { status: "running", lockedBy: job.lockedBy, lockedAt: new Date(), attempts: 2 },
    });
    expect(await failJob(db, { ...job, attempts: 2 }, "boom again")).toBe("failed");
    expect((await db.job.findUniqueOrThrow({ where: { id } })).status).toBe("failed");
  });

  it("keeps a heartbeated job locked past the stale threshold", async () => {
    const { id } = await enqueueJob(db, "weekly-bulletin", {
      dedupeKey: `${key}-heartbeat`,
      runAfter: new Date(Date.now() - 1000),
    });
    let job = await claimNextJob(db, "w-heartbeat");
    while (job && job.id !== id) job = await claimNextJob(db, "w-heartbeat");
    expect(job?.lockedBy).toBe("w-heartbeat");
    const old = new Date(Date.now() - 45 * 60_000);
    await db.job.update({ where: { id }, data: { lockedAt: old } });

    expect(await touchJob(db, id, "w-heartbeat")).toBe(true);
    expect(await touchJob(db, id, "someone-else")).toBe(false);
    await releaseStaleJobs(db);
    expect((await db.job.findUniqueOrThrow({ where: { id } })).status).toBe("running");

    // Without a heartbeat the same lock age is released.
    await db.job.update({ where: { id }, data: { lockedAt: old } });
    await releaseStaleJobs(db);
    const released = await db.job.findUniqueOrThrow({ where: { id } });
    expect(released.status).toBe("pending");
    expect(await touchJob(db, id, "w-heartbeat")).toBe(false);
  });
});
