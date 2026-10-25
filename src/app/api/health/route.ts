import { getDb } from "@/lib/db/client";
import { envWarnings } from "@/lib/env";
import { JOB_TYPES } from "@/lib/jobs/types";
import { log } from "@/lib/log";

interface LastRunRow {
  jobType: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  error: string | null;
}

export async function GET(): Promise<Response> {
  const warnings = envWarnings();
  try {
    const db = getDb();
    await db.$queryRaw`SELECT 1`;
    const [lastRuns, pendingJobs, failedJobs] = await Promise.all([
      db.$queryRaw<LastRunRow[]>`
        SELECT DISTINCT ON ("jobType") "jobType", "status"::text AS "status", "startedAt", "finishedAt", "error"
        FROM "run" ORDER BY "jobType", "startedAt" DESC`,
      db.job.count({ where: { status: "pending" } }),
      db.job.count({ where: { status: "failed" } }),
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
    return Response.json(
      {
        ok: true,
        db: "ok",
        lastRuns: runs,
        jobs: { pending: pendingJobs, failed: failedJobs },
        warnings,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    log.error({ err }, "health: database check failed");
    return Response.json(
      { ok: false, db: "error", warnings },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
