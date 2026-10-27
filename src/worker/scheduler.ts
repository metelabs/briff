import cron, { type ScheduledTask } from "node-cron";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { enqueueJob } from "@/lib/jobs/queue";
import type { JobType } from "@/lib/jobs/types";
import type { Logger } from "@/lib/log";

export interface ScheduleEntry {
  type: JobType;
  cron: string;
  payload?: Prisma.InputJsonObject;
}

// All times UTC. 04:00 UTC is 07:00 in Türkiye.
export const SCHEDULE: ScheduleEntry[] = [
  { type: "refresh-packages", cron: "0 3 * * *" },
  { type: "security-scan", cron: "0 4 * * *" },
  { type: "base-image-scan", cron: "15 4 * * *" },
  { type: "weekly-bulletin", cron: "0 4 * * 1" },
  // Hourly: security sources every run, the others when their last fetch is ~6h old
  // (`due`, see isSourceDue in src/sources/collect.ts).
  { type: "collect-sources", cron: "0 * * * *", payload: { due: true } },
  // collect-sources enqueues triage itself; this catches items left by a failed run.
  { type: "triage-items", cron: "30 */6 * * *" },
];

export function startScheduler(db: PrismaClient, log: Logger): ScheduledTask[] {
  return SCHEDULE.map(({ type, cron: expression, payload }) =>
    cron.schedule(
      expression,
      async () => {
        try {
          const result = await enqueueJob(db, type, payload ? { payload } : {});
          log.info({ type, ...result }, "scheduler: enqueued");
        } catch (err) {
          log.error({ err, type }, "scheduler: enqueue failed");
        }
      },
      { timezone: "UTC", name: type, noOverlap: true }
    )
  );
}
