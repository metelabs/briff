import cron, { type ScheduledTask } from "node-cron";

import type { PrismaClient } from "@/generated/prisma/client";
import { enqueueJob } from "@/lib/jobs/queue";
import { SCHEDULE } from "@/lib/jobs/schedule";
import type { Logger } from "@/lib/log";

export { SCHEDULE, type ScheduleEntry } from "@/lib/jobs/schedule";

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
