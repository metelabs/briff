// Pure helpers for Admin → Runs (src/app/admin/runs/page.tsx).

export interface RunRow {
  id: string;
  jobType: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  counts: unknown;
  error: string | null;
}

export interface RunGroup {
  jobType: string;
  runs: RunRow[];
  succeeded: number;
  failed: number;
}

/** One group per known job type (in that order, empty ones included), runs newest first. */
export function groupRuns(rows: readonly RunRow[], jobTypes: readonly string[]): RunGroup[] {
  const groups = new Map<string, RunGroup>(
    jobTypes.map((t) => [t, { jobType: t, runs: [], succeeded: 0, failed: 0 }])
  );
  for (const row of rows) {
    let group = groups.get(row.jobType);
    if (!group) {
      group = { jobType: row.jobType, runs: [], succeeded: 0, failed: 0 };
      groups.set(row.jobType, group);
    }
    group.runs.push(row);
    if (row.status === "succeeded") group.succeeded++;
    if (row.status === "failed") group.failed++;
  }
  for (const group of groups.values()) {
    group.runs.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  }
  return [...groups.values()];
}

/** "850 ms", "42 s", "4 min 12 s", "1 h 3 min"; null while the run has not finished. */
export function durationLabel(run: Pick<RunRow, "startedAt" | "finishedAt">): string | null {
  if (!run.finishedAt) return null;
  const ms = Math.max(0, run.finishedAt.getTime() - run.startedAt.getTime());
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Non-zero counts as "fetched 12 · failed 1". */
export function countsLabel(counts: unknown): string {
  if (!counts || typeof counts !== "object") return "";
  return Object.entries(counts as Record<string, unknown>)
    .filter(([, v]) => v !== 0 && v !== false && v !== null)
    .map(([k, v]) => `${k} ${String(v)}`)
    .join(" · ");
}
