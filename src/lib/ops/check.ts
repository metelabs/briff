import "server-only";

import type { JobContext, JobResult } from "@/worker/types";

import { sendOpsAlert, type OpsAlertOutcome } from "./alerts";
import { loadJobHealth } from "./health";

/**
 * Failed jobs are revisited for this long: the stale-lock release fails jobs without the runner
 * reporting them, and a runner alert whose channels all failed released its slot. Shorter than
 * the 24h dedupe window, so a delivered alert is never sent again.
 */
const FAILED_LOOKBACK_MS = 2 * 3_600_000;

/**
 * ops-check (every 30 min): one alert per stale scheduled job type, and a retry of the failure
 * alert for job types with a recently failed job (already delivered ones are deduped). Dedupe
 * is in sendOpsAlert (24h per job type and kind).
 */
export async function opsCheck(ctx: JobContext): Promise<JobResult> {
  const { db, log } = ctx;
  const now = new Date();
  const health = await loadJobHealth(db, now);
  const counts: Record<OpsAlertOutcome | "stale" | "failedJobs", number> = {
    stale: 0,
    failedJobs: 0,
    sent: 0,
    deduped: 0,
    skipped: 0,
    failed: 0,
  };

  // This job is running, so its own staleness is already over.
  for (const jobType of health.stale.filter((t) => t !== "ops-check")) {
    counts.stale++;
    await ctx.heartbeat();
    const row = health.freshness[jobType];
    const outcome = await sendOpsAlert(
      db,
      {
        kind: "stale",
        jobType,
        at: row?.dueBy ?? now,
        lastSuccessAt: row?.lastSuccessAt ?? null,
      },
      log,
      now,
      ctx.heartbeat
    );
    counts[outcome]++;
  }

  const failed = await db.job.findMany({
    where: {
      status: "failed",
      updatedAt: { gte: new Date(now.getTime() - FAILED_LOOKBACK_MS) },
    },
    orderBy: { updatedAt: "desc" },
    distinct: ["type"],
    select: { type: true, updatedAt: true, attempts: true, lastError: true },
  });
  for (const job of failed) {
    counts.failedJobs++;
    await ctx.heartbeat();
    const outcome = await sendOpsAlert(
      db,
      {
        kind: "failed",
        jobType: job.type,
        at: job.updatedAt,
        error:
          job.lastError === "lock expired"
            ? "lock expired: the worker running this job stopped (crash or restart) on its last attempt"
            : job.lastError,
        attempts: job.attempts,
        revisit: true,
        lastSuccessAt: health.freshness[job.type]?.lastSuccessAt ?? null,
      },
      log,
      now,
      ctx.heartbeat
    );
    counts[outcome]++;
  }
  return { counts };
}
