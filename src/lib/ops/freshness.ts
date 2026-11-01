import { SCHEDULE } from "@/lib/jobs/schedule";
import type { JobType } from "@/lib/jobs/types";

import { cronIntervalMs } from "./cron";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export type Freshness = "ok" | "stale" | "never";

/** Slack on top of the schedule's interval: a day for weekly jobs, two hours otherwise. */
export function graceMs(intervalMs: number): number {
  return intervalMs >= 7 * DAY_MS ? DAY_MS : 2 * HOUR_MS;
}

/** How long a scheduled job type may go without a success: daily 26h, hourly 3h, weekly 8d. */
export function staleAfterMs(cron: string): number {
  const interval = cronIntervalMs(cron);
  return interval + graceMs(interval);
}

export interface FreshnessFacts {
  lastSuccessAt: Date | null;
  /** When a job of this type was first queued: the schedule (or an admin) expected it to run. */
  firstQueuedAt: Date | null;
}

export interface FreshnessResult {
  status: Freshness;
  /** Stale after this instant; null while nothing was ever expected. */
  dueBy: Date | null;
}

/**
 * `ok` while the last success is younger than staleAfterMs; `stale` past it. A type that never
 * succeeded is `never` until its first queued job is a grace period old (then `stale`), so a
 * fresh install, or a job type added by an upgrade, does not alert before it was due.
 */
export function jobFreshness(cron: string, facts: FreshnessFacts, now: Date): FreshnessResult {
  if (facts.lastSuccessAt) {
    const dueBy = new Date(facts.lastSuccessAt.getTime() + staleAfterMs(cron));
    return { status: now > dueBy ? "stale" : "ok", dueBy };
  }
  if (!facts.firstQueuedAt) return { status: "never", dueBy: null };
  const dueBy = new Date(facts.firstQueuedAt.getTime() + graceMs(cronIntervalMs(cron)));
  return { status: now > dueBy ? "stale" : "never", dueBy };
}

export const SCHEDULED_TYPES: readonly JobType[] = SCHEDULE.map((s) => s.type);

export function cronOf(type: JobType): string | null {
  return SCHEDULE.find((s) => s.type === type)?.cron ?? null;
}
