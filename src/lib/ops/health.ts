import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import type { JobType } from "@/lib/jobs/types";
import { ORG_SECURITY_SCAN_PREFIX } from "@/security/plan";

import { cronOf, jobFreshness, SCHEDULED_TYPES, type FreshnessResult } from "./freshness";

/** A due pending job older than this means the worker is not draining the queue. */
export const QUEUE_LAG_LIMIT_SECONDS = 3600;

export interface JobFreshnessRow extends FreshnessResult {
  lastSuccessAt: Date | null;
}

export interface JobHealth {
  freshness: Record<string, JobFreshnessRow>;
  stale: JobType[];
  /** Age of the oldest pending job whose runAfter has passed; null when none is due. */
  oldestPendingSeconds: number | null;
}

export async function loadJobHealth(db: PrismaClient, now: Date = new Date()): Promise<JobHealth> {
  const [successes, oldestDue] = await Promise.all([
    db.run.groupBy({
      by: ["jobType"],
      where: {
        status: "succeeded",
        jobType: { in: [...SCHEDULED_TYPES] },
        // An org's re-check covers one org; only the full run proves the schedule works.
        NOT: { job: { is: { dedupeKey: { startsWith: ORG_SECURITY_SCAN_PREFIX } } } },
      },
      _max: { finishedAt: true },
    }),
    db.job.findFirst({
      where: { status: "pending", runAfter: { lte: now } },
      orderBy: { runAfter: "asc" },
      select: { runAfter: true },
    }),
  ]);
  const lastSuccess = new Map(successes.map((r) => [r.jobType, r._max.finishedAt]));
  const neverSucceeded = SCHEDULED_TYPES.filter((t) => !lastSuccess.get(t));
  const firstQueued =
    neverSucceeded.length === 0
      ? []
      : await db.job.groupBy({
          by: ["type"],
          where: { type: { in: neverSucceeded } },
          _min: { createdAt: true },
        });
  const queuedAt = new Map(firstQueued.map((r) => [r.type, r._min.createdAt]));

  const freshness: Record<string, JobFreshnessRow> = {};
  const stale: JobType[] = [];
  for (const type of SCHEDULED_TYPES) {
    const cron = cronOf(type);
    if (!cron) continue;
    const lastSuccessAt = lastSuccess.get(type) ?? null;
    const result = jobFreshness(
      cron,
      { lastSuccessAt, firstQueuedAt: queuedAt.get(type) ?? null },
      now
    );
    freshness[type] = { ...result, lastSuccessAt };
    if (result.status === "stale") stale.push(type);
  }
  const oldestPendingSeconds = oldestDue
    ? Math.max(0, Math.floor((now.getTime() - oldestDue.runAfter.getTime()) / 1000))
    : null;
  return { freshness, stale, oldestPendingSeconds };
}

/** Healthy when no scheduled job type is stale and the queue is drained within the limit. */
export function isHealthy(health: JobHealth): boolean {
  return health.stale.length === 0 && (health.oldestPendingSeconds ?? 0) <= QUEUE_LAG_LIMIT_SECONDS;
}
