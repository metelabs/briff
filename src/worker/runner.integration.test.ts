import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { claimNextJob, completeJob, enqueueJob, JobLockLostError } from "@/lib/jobs/queue";
import type { JobType } from "@/lib/jobs/types";
import { log } from "@/lib/log";

import { runJob } from "./runner";
import type { JobHandler } from "./types";

// Runs only when TEST_DATABASE_URL points at a migrated, disposable database.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("runner and job locks against Postgres", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const key = `runner-${Date.now().toString(36)}`;

  beforeEach(async () => {
    await db.job.deleteMany({ where: { dedupeKey: { startsWith: key } } });
  });

  afterAll(async () => {
    await db.job.deleteMany({ where: { dedupeKey: { startsWith: key } } });
    await db.$disconnect();
  });

  async function claimOwn(type: JobType, worker: string) {
    const { id } = await enqueueJob(db, type, {
      dedupeKey: `${key}-${worker}`,
      runAfter: new Date(Date.now() - 1000),
    });
    let job = await claimNextJob(db, worker);
    while (job && job.id !== id) job = await claimNextJob(db, worker);
    if (!job) throw new Error("job not claimed");
    return job;
  }

  /** Simulates a stale-lock release followed by another worker's claim. */
  const takeOver = (id: string) =>
    db.job.update({ where: { id }, data: { lockedBy: "w-other", lockedAt: new Date() } });

  const handlersWith = (handler: JobHandler) =>
    ({ "weekly-bulletin": handler }) as unknown as Record<JobType, JobHandler>;

  it("aborts a handler whose heartbeat finds the lock lost, without touching the job", async () => {
    const job = await claimOwn("weekly-bulletin", "w-lost");
    let afterHeartbeat = false;
    const outcome = await runJob(
      db,
      handlersWith(async (ctx) => {
        await takeOver(job.id);
        await ctx.heartbeat();
        afterHeartbeat = true;
        return {};
      }),
      job,
      log
    );
    expect(outcome).toBe("lost");
    expect(afterHeartbeat).toBe(false);
    const row = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({ status: "running", lockedBy: "w-other", lastError: null });
    const run = await db.run.findFirstOrThrow({ where: { jobId: job.id } });
    expect(run.error).toContain("JobLockLostError");
  });

  it("does not complete a job another worker took over", async () => {
    const job = await claimOwn("weekly-bulletin", "w-late");
    const outcome = await runJob(
      db,
      handlersWith(async () => {
        await takeOver(job.id);
        return {};
      }),
      job,
      log
    );
    expect(outcome).toBe("lost");
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("running");
    expect(await completeJob(db, { id: job.id, lockedBy: "w-other" })).toBe(true);
    expect(new JobLockLostError("x").name).toBe("JobLockLostError");
  });
});
