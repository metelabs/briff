import { loadRuntimeLifecycle } from "@/lib/runtime-eol-catalog";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  claimNextJob,
  completeJob,
  failJob,
  JobLockLostError,
  touchJob,
  type ClaimedJob,
} from "@/lib/jobs/queue";
import { isJobType, type JobType } from "@/lib/jobs/types";
import type { Logger } from "@/lib/log";
import { sendOpsAlert } from "@/lib/ops/alerts";
import { captureException } from "@/lib/sentry";

import type { JobHandler } from "./types";

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.stack ?? err.message;
  return String(err);
}

/** Runs one claimed job and records a Run row. Never throws. */
/**
 * Alerts the operators about a job that failed for good. Never throws. The job is no longer
 * locked here (failJob released it), so there is no job heartbeat to keep alive.
 */
async function reportFinalFailure(
  db: PrismaClient,
  job: ClaimedJob,
  err: unknown,
  error: string,
  log: Logger
): Promise<void> {
  await captureException(err, { jobType: job.type, attempts: job.attempts });
  try {
    const lastSuccess = await db.run.findFirst({
      where: { jobType: job.type, status: "succeeded" },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    });
    const outcome = await sendOpsAlert(
      db,
      {
        kind: "failed",
        jobType: job.type,
        at: new Date(),
        error,
        attempts: job.attempts,
        lastSuccessAt: lastSuccess?.finishedAt ?? null,
      },
      log
    );
    log.info({ outcome }, "ops alert: job failure");
  } catch (alertErr) {
    log.error({ err: alertErr }, "ops alert: could not report job failure");
  }
}

export async function runJob(
  db: PrismaClient,
  handlers: Record<JobType, JobHandler>,
  job: ClaimedJob,
  log: Logger,
  /** Also refreshes the worker's heartbeat file (src/worker/heartbeat-file.ts). */
  touchHeartbeat: () => Promise<void> = async () => {}
): Promise<"succeeded" | "retry" | "failed" | "lost"> {
  const jobLog = log.child({ jobId: job.id, jobType: job.type, attempt: job.attempts });
  const run = await db.run.create({ data: { jobId: job.id, jobType: job.type } });
  const startedAt = Date.now();

  try {
    if (!isJobType(job.type)) throw new Error(`unknown job type: ${job.type}`);
    await loadRuntimeLifecycle(db);
    const result = await handlers[job.type]({
      db,
      log: jobLog,
      jobId: job.id,
      payload: job.payload,
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
      // Another worker may own the job now: abort instead of racing it.
      heartbeat: async () => {
        await touchHeartbeat();
        if (!(await touchJob(db, job.id, job.lockedBy))) throw new JobLockLostError(job.id);
      },
    });
    await db.run.update({
      where: { id: run.id },
      data: {
        status: "succeeded",
        finishedAt: new Date(),
        counts: (result.counts ?? {}) as Prisma.InputJsonValue,
        tokens: (result.tokens ?? {}) as Prisma.InputJsonValue,
      },
    });
    if (!(await completeJob(db, job))) {
      jobLog.warn(
        { ms: Date.now() - startedAt },
        "job finished after its lock was lost; not completed"
      );
      return "lost";
    }
    jobLog.info({ ms: Date.now() - startedAt, counts: result.counts }, "job succeeded");
    return "succeeded";
  } catch (err) {
    const message = errorMessage(err).slice(0, 4000);
    await db.run.update({
      where: { id: run.id },
      data: { status: "failed", finishedAt: new Date(), error: message },
    });
    const outcome = await failJob(db, job, message);
    if (outcome === "lost") {
      jobLog.warn({ err, ms: Date.now() - startedAt }, "job lock lost; attempt abandoned");
      return outcome;
    }
    jobLog.error({ err, outcome, ms: Date.now() - startedAt }, "job failed");
    if (outcome === "failed") await reportFinalFailure(db, job, err, message, jobLog);
    return outcome;
  }
}

/** Claims and runs jobs until none are due. Returns how many ran. */
export async function drainQueue(
  db: PrismaClient,
  handlers: Record<JobType, JobHandler>,
  workerId: string,
  log: Logger,
  shouldStop: () => boolean = () => false,
  touchHeartbeat?: () => Promise<void>
): Promise<number> {
  let ran = 0;
  while (!shouldStop()) {
    await touchHeartbeat?.();
    const job = await claimNextJob(db, workerId);
    if (!job) break;
    await runJob(db, handlers, job, log, touchHeartbeat);
    ran++;
  }
  return ran;
}
