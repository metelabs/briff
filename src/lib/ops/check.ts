import "server-only";

import type { JobContext, JobResult } from "@/worker/types";

import { sendOpsAlert, type OpsAlertOutcome } from "./alerts";
import { loadJobHealth } from "./health";

/** Jobs failed by the stale-lock release (no runner to report them) within this window. */
const LOCK_EXPIRED_LOOKBACK_MS = 2 * 3_600_000;

/**
 * ops-check (every 30 min): one alert per stale scheduled job type, and one per job type whose
 * job was failed by the stale-lock release rather than by the runner. Dedupe is in
 * sendOpsAlert (24h per job type and kind).
 */
export async function opsCheck(ctx: JobContext): Promise<JobResult> {
  const { db, log } = ctx;
  const now = new Date();
  const health = await loadJobHealth(db, now);
  const counts: Record<OpsAlertOutcome | "stale" | "lockExpired", number> = {
    stale: 0,
    lockExpired: 0,
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
      now
    );
    counts[outcome]++;
  }

  const expired = await db.job.findMany({
    where: {
      status: "failed",
      lastError: "lock expired",
      updatedAt: { gte: new Date(now.getTime() - LOCK_EXPIRED_LOOKBACK_MS) },
    },
    orderBy: { updatedAt: "desc" },
    distinct: ["type"],
    select: { type: true, updatedAt: true, attempts: true },
  });
  for (const job of expired) {
    counts.lockExpired++;
    await ctx.heartbeat();
    const outcome = await sendOpsAlert(
      db,
      {
        kind: "failed",
        jobType: job.type,
        at: job.updatedAt,
        error:
          "lock expired: the worker running this job stopped (crash or restart) on its last attempt",
        attempts: job.attempts,
        lastSuccessAt: health.freshness[job.type]?.lastSuccessAt ?? null,
      },
      log,
      now
    );
    counts[outcome]++;
  }
  return { counts };
}
