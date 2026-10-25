import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import { retryDelayMs } from "./backoff";
import type { JobType } from "./types";

export interface EnqueueOptions {
  payload?: Prisma.InputJsonValue;
  runAfter?: Date;
  maxAttempts?: number;
  /** Defaults to the job type: at most one pending job per type. */
  dedupeKey?: string;
}

export interface EnqueueResult {
  id: string;
  created: boolean;
}

/**
 * Idempotent enqueue: if a job with the same dedupe key is still pending, it is
 * returned instead of inserting a duplicate. An advisory lock on the key makes
 * the check-then-insert safe across concurrent web and worker processes.
 */
export async function enqueueJob(
  db: PrismaClient,
  type: JobType,
  options: EnqueueOptions = {}
): Promise<EnqueueResult> {
  const dedupeKey = options.dedupeKey ?? type;
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${dedupeKey}))`;
    const existing = await tx.job.findFirst({
      where: { dedupeKey, status: "pending" },
      select: { id: true },
    });
    if (existing) return { id: existing.id, created: false };
    const job = await tx.job.create({
      data: {
        type,
        dedupeKey,
        payload: options.payload ?? {},
        runAfter: options.runAfter ?? new Date(),
        maxAttempts: options.maxAttempts ?? 5,
      },
      select: { id: true },
    });
    return { id: job.id, created: true };
  });
}

export interface ScheduleOptions {
  dedupeKey: string;
  runAfter: Date;
  payload?: Prisma.InputJsonValue;
  /** Only move a pending job; create nothing when none is pending. */
  onlyIfPending?: boolean;
}

/**
 * Debounced enqueue: a pending job with the key gets `runAfter` moved to the given time
 * (later for another upload of the same scan, now once the scan is complete); without
 * one a job is created, unless `onlyIfPending`. Same advisory lock as enqueueJob.
 */
export async function scheduleJob(
  db: PrismaClient,
  type: JobType,
  options: ScheduleOptions
): Promise<(EnqueueResult & { runAfter: Date }) | null> {
  const { dedupeKey, runAfter } = options;
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${dedupeKey}))`;
    const existing = await tx.job.findFirst({
      where: { dedupeKey, status: "pending" },
      select: { id: true },
    });
    if (existing) {
      await tx.job.update({ where: { id: existing.id }, data: { runAfter } });
      return { id: existing.id, created: false, runAfter };
    }
    if (options.onlyIfPending) return null;
    const job = await tx.job.create({
      data: { type, dedupeKey, payload: options.payload ?? {}, runAfter, maxAttempts: 5 },
      select: { id: true },
    });
    return { id: job.id, created: true, runAfter };
  });
}

export interface ClaimedJob {
  id: string;
  type: string;
  lockedBy: string;
  payload: Prisma.JsonValue;
  attempts: number;
  maxAttempts: number;
}

/** Claims the oldest due job. SKIP LOCKED lets several workers poll safely. */
export async function claimNextJob(db: PrismaClient, workerId: string): Promise<ClaimedJob | null> {
  const rows = await db.$queryRaw<ClaimedJob[]>`
    UPDATE "job"
    SET "status" = 'running', "lockedAt" = (now() AT TIME ZONE 'UTC'), "lockedBy" = ${workerId},
        "attempts" = "attempts" + 1, "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE "id" = (
      SELECT "id" FROM "job"
      WHERE "status" = 'pending' AND "runAfter" <= (now() AT TIME ZONE 'UTC')
      ORDER BY "runAfter" ASC, "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING "id", "type", "lockedBy", "payload", "attempts", "maxAttempts"`;
  return rows[0] ?? null;
}

/** Thrown by a job's heartbeat when another worker took the job over (stale-lock release). */
export class JobLockLostError extends Error {
  constructor(jobId: string) {
    super(`job ${jobId}: lock lost`);
    this.name = "JobLockLostError";
  }
}

/** The job this worker claimed, still running and still locked by it. */
const heldBy = (job: Pick<ClaimedJob, "id" | "lockedBy">) => ({
  id: job.id,
  status: "running" as const,
  lockedBy: job.lockedBy,
});

/** Marks the job succeeded. False (and nothing written) when this worker no longer holds it. */
export async function completeJob(
  db: PrismaClient,
  job: Pick<ClaimedJob, "id" | "lockedBy">
): Promise<boolean> {
  const updated = await db.job.updateMany({
    where: heldBy(job),
    data: { status: "succeeded", lockedAt: null, lockedBy: null, lastError: null },
  });
  return updated.count === 1;
}

/**
 * Re-queues with exponential backoff, or marks failed once attempts are exhausted.
 * `lost` (nothing written) when this worker no longer holds the job.
 */
export async function failJob(
  db: PrismaClient,
  job: Pick<ClaimedJob, "id" | "lockedBy" | "attempts" | "maxAttempts">,
  error: string,
  now: Date = new Date()
): Promise<"retry" | "failed" | "lost"> {
  const exhausted = job.attempts >= job.maxAttempts;
  const updated = await db.job.updateMany({
    where: heldBy(job),
    data: exhausted
      ? { status: "failed", lockedAt: null, lockedBy: null, lastError: error }
      : {
          status: "pending",
          lockedAt: null,
          lockedBy: null,
          lastError: error,
          runAfter: new Date(now.getTime() + retryDelayMs(job.attempts)),
        },
  });
  if (updated.count === 0) return "lost";
  return exhausted ? "failed" : "retry";
}

/**
 * Moves the lock forward for a job this worker still holds. Returns false when the
 * lock was lost (released as stale and possibly claimed by another worker).
 */
export async function touchJob(
  db: PrismaClient,
  jobId: string,
  workerId: string
): Promise<boolean> {
  const updated = await db.job.updateMany({
    where: { id: jobId, status: "running", lockedBy: workerId },
    data: { lockedAt: new Date() },
  });
  return updated.count === 1;
}

// Columns are UTC `timestamp(3)` (Prisma default), so raw SQL compares against UTC now.
const STALE_LOCK_MS = 30 * 60_000;

/** Returns jobs orphaned by a crashed worker to the queue (or fails them if out of attempts). */
export async function releaseStaleJobs(db: PrismaClient, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_LOCK_MS);
  const failed = await db.$executeRaw`
    UPDATE "job" SET "status" = 'failed', "lockedAt" = NULL, "lockedBy" = NULL,
      "lastError" = 'lock expired', "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE "status" = 'running' AND "lockedAt" < ${cutoff} AND "attempts" >= "maxAttempts"`;
  const requeued = await db.$executeRaw`
    UPDATE "job" SET "status" = 'pending', "lockedAt" = NULL, "lockedBy" = NULL,
      "lastError" = 'lock expired', "runAfter" = (now() AT TIME ZONE 'UTC'), "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE "status" = 'running' AND "lockedAt" < ${cutoff}`;
  return failed + requeued;
}
