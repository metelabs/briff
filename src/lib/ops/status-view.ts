import { z } from "zod";

import type { JobType } from "@/lib/jobs/types";

// The public /status page's model of a /api/health answer (docs/OPERATIONS.md). Pure: the page
// fetches the route, this turns the body into an overall state and components. It shows no
// error text, warnings or counts beyond what /api/health already answers to anyone.

const freshnessSchema = z.object({
  status: z.enum(["ok", "stale", "never"]),
  lastSuccessAt: z.string().nullable(),
  dueBy: z.string().nullable(),
});

const healthSchema = z.object({
  ok: z.boolean(),
  db: z.string(),
  freshness: z.record(z.string(), freshnessSchema).optional(),
  queue: z
    .object({ oldestPendingSeconds: z.number().nullable(), limitSeconds: z.number() })
    .optional(),
});

export type Overall = "operational" | "degraded" | "down";
export type ComponentState = "operational" | "degraded" | "down" | "unknown";
export type JobState = "on-schedule" | "late" | "not-run-yet";

export interface StatusJob {
  type: string;
  label: string;
  cadence: string;
  state: JobState;
  lastSuccessAt: Date | null;
}

export interface StatusComponent {
  name: string;
  state: ComponentState;
  detail: string;
}

export interface StatusView {
  overall: Overall;
  headline: string;
  components: StatusComponent[];
  jobs: StatusJob[];
  /** Oldest due job's wait; null when the check did not answer. */
  queue: { oldestPendingSeconds: number | null; limitSeconds: number; late: boolean } | null;
}

/** Scheduled job types in the order an operator reads them (src/lib/jobs/schedule.ts). */
const JOBS: readonly { type: JobType; label: string; cadence: string }[] = [
  { type: "collect-sources", label: "Source collection", cadence: "hourly" },
  { type: "triage-items", label: "Triage", cadence: "every 6 hours" },
  { type: "security-scan", label: "Security scan", cadence: "daily, 04:00 UTC" },
  { type: "base-image-scan", label: "Base image scan", cadence: "daily, 04:15 UTC" },
  { type: "refresh-packages", label: "Package versions", cadence: "daily, 03:00 UTC" },
  {
    type: "refresh-runtime-lifecycle",
    label: "Runtime lifecycle",
    cadence: "daily, 02:30 UTC",
  },
  { type: "weekly-bulletin", label: "Weekly bulletin", cadence: "Mondays, 04:00 UTC" },
  { type: "ops-check", label: "Ops check", cadence: "every 30 minutes" },
];

const JOB_STATE: Record<z.infer<typeof freshnessSchema>["status"], JobState> = {
  ok: "on-schedule",
  stale: "late",
  never: "not-run-yet",
};

export const OVERALL_HEADLINE: Record<Overall, string> = {
  operational: "All systems operational",
  degraded: "Degraded: some background work is running late",
  down: "Down: the service cannot reach its database",
};

function jobsOf(freshness: Record<string, z.infer<typeof freshnessSchema>>): StatusJob[] {
  const known = JOBS.filter((j) => freshness[j.type]);
  const extra = Object.keys(freshness)
    .filter((type) => !JOBS.some((j) => j.type === type))
    .map((type) => ({ type, label: type, cadence: "scheduled" }));
  return [...known, ...extra].map((j) => {
    const f = freshness[j.type];
    return {
      type: j.type,
      label: j.label,
      cadence: j.cadence,
      state: JOB_STATE[f.status],
      lastSuccessAt: f.lastSuccessAt ? new Date(f.lastSuccessAt) : null,
    };
  });
}

/** `body` is the parsed /api/health JSON, or null when the request failed. */
export function statusView(body: unknown): StatusView {
  const parsed = healthSchema.safeParse(body);
  if (!parsed.success || parsed.data.db !== "ok") {
    return {
      overall: "down",
      headline: OVERALL_HEADLINE.down,
      components: [
        { name: "Web", state: "operational", detail: "Serving this page" },
        {
          name: "Database",
          state: "down",
          detail: parsed.success ? "Not reachable" : "The health check did not answer",
        },
        { name: "Worker", state: "unknown", detail: "Unknown while the database is down" },
      ],
      jobs: [],
      queue: null,
    };
  }
  const health = parsed.data;
  const jobs = jobsOf(health.freshness ?? {});
  const queue = health.queue
    ? {
        ...health.queue,
        late: (health.queue.oldestPendingSeconds ?? 0) > health.queue.limitSeconds,
      }
    : null;
  const late = jobs.filter((j) => j.state === "late");
  const workerProblems = [
    ...(late.length > 0 ? [`${late.length} late: ${late.map((j) => j.label).join(", ")}`] : []),
    ...(queue?.late ? ["the queue is not draining"] : []),
  ];
  const workerOk = health.ok && workerProblems.length === 0;
  const overall: Overall = workerOk ? "operational" : "degraded";
  return {
    overall,
    headline: OVERALL_HEADLINE[overall],
    components: [
      { name: "Web", state: "operational", detail: "Serving this page" },
      { name: "Database", state: "operational", detail: "Connected" },
      {
        name: "Worker",
        state: workerOk ? "operational" : "degraded",
        detail: workerOk
          ? jobs.every((j) => j.state === "not-run-yet")
            ? "No scheduled job has run yet"
            : "Scheduled jobs on time"
          : // `ok: false` with nothing late here means a job type this page does not list.
            workerProblems.join("; ") || "A scheduled job is late",
      },
    ],
    jobs,
    queue,
  };
}

/** "12 s", "4 min", "2 h 5 min". */
export function durationLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** "3 min ago", "5 h ago", "2 days ago" from `now`. */
export function agoLabel(at: Date, now: Date): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 86_400) return `${durationLabel(seconds - (seconds % 60))} ago`;
  const days = Math.floor(seconds / 86_400);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** "2026-11-02 14:05 UTC". */
export function utcLabel(d: Date): string {
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}
