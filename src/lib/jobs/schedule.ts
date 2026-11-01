import type { Prisma } from "@/generated/prisma/client";

import type { JobType } from "./types";

export interface ScheduleEntry {
  type: JobType;
  cron: string;
  payload?: Prisma.InputJsonObject;
}

// All times UTC. 04:00 UTC is 07:00 in Türkiye. Plain data, so the web app (health, admin)
// can derive expected intervals without loading the scheduler.
export const SCHEDULE: ScheduleEntry[] = [
  { type: "refresh-runtime-lifecycle", cron: "30 2 * * *" },
  { type: "refresh-packages", cron: "0 3 * * *" },
  { type: "security-scan", cron: "0 4 * * *" },
  { type: "base-image-scan", cron: "15 4 * * *" },
  { type: "weekly-bulletin", cron: "0 4 * * 1" },
  // Hourly: security sources every run, the others when their last fetch is ~6h old
  // (`due`, see isSourceDue in src/sources/collect.ts).
  { type: "collect-sources", cron: "0 * * * *", payload: { due: true } },
  // collect-sources enqueues triage itself; this catches items left by a failed run.
  { type: "triage-items", cron: "30 */6 * * *" },
  // Staleness alerts (src/lib/ops/check.ts).
  { type: "ops-check", cron: "10,40 * * * *" },
  // Paddle subscriptions: missed webhooks, past_due grace, canceled periods (docs/BILLING.md).
  { type: "billing-check", cron: "45 5 * * *" },
];
