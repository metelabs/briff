import { getDb } from "@/lib/db/client";
import { envWarnings } from "@/lib/env";
import { JOB_TYPES } from "@/lib/jobs/types";
import { log } from "@/lib/log";
import { isHealthy, loadJobHealth, QUEUE_LAG_LIMIT_SECONDS } from "@/lib/ops/health";

interface LastRunRow {
  jobType: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  error: string | null;
}

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Full health (docs/OPERATIONS.md): 503 when the database is down, a scheduled job type is
 * stale or a due job waits longer than an hour. `?probe=live` only checks the database: the
 * container healthcheck uses it, so a stuck worker never gets the web container restarted.
 */
export async function GET(request: Request): Promise<Response> {
  const live = new URL(request.url).searchParams.get("probe") === "live";
  const warnings = envWarnings();
  try {
    const db = getDb();
    await db.$queryRaw`SELECT 1`;
    if (live) return Response.json({ ok: true, db: "ok" }, { headers: NO_STORE });
    const now = new Date();
    const [lastRuns, pendingJobs, failedJobs, health] = await Promise.all([
      db.$queryRaw<LastRunRow[]>`
        SELECT DISTINCT ON ("jobType") "jobType", "status"::text AS "status", "startedAt", "finishedAt", "error"
        FROM "run" ORDER BY "jobType", "startedAt" DESC`,
      db.job.count({ where: { status: "pending" } }),
      db.job.count({ where: { status: "failed" } }),
      loadJobHealth(db, now),
    ]);
    const byType = new Map(lastRuns.map((r) => [r.jobType, r]));
    const runs = Object.fromEntries(
      JOB_TYPES.map((type) => {
        const run = byType.get(type);
        return [
          type,
          run
            ? {
                status: run.status,
                startedAt: run.startedAt.toISOString(),
                finishedAt: run.finishedAt?.toISOString() ?? null,
                error: run.error,
              }
            : null,
        ];
      })
    );
    const freshness = Object.fromEntries(
      Object.entries(health.freshness).map(([type, f]) => [
        type,
        {
          status: f.status,
          lastSuccessAt: f.lastSuccessAt?.toISOString() ?? null,
          dueBy: f.dueBy?.toISOString() ?? null,
        },
      ])
    );
    const ok = isHealthy(health);
    return Response.json(
      {
        ok,
        db: "ok",
        freshness,
        stale: health.stale,
        queue: {
          oldestPendingSeconds: health.oldestPendingSeconds,
          limitSeconds: QUEUE_LAG_LIMIT_SECONDS,
        },
        lastRuns: runs,
        jobs: { pending: pendingJobs, failed: failedJobs },
        warnings,
      },
      { status: ok ? 200 : 503, headers: NO_STORE }
    );
  } catch (err) {
    log.error({ err }, "health: database check failed");
    return Response.json({ ok: false, db: "error", warnings }, { status: 503, headers: NO_STORE });
  }
}
