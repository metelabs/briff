import { severityRank } from "@/security/plan";

import { weekStartOf } from "./bulletin";

// Pure pieces of the home overview: the 12-week attention series per stream, the backlog's
// severity split and the next bulletin time. The page only loads rows and draws.

const WEEK_MS = 7 * 86_400_000;

/** Monday 00:00 UTC of the last `count` weeks, oldest first, ending with this week. */
export function lastWeeks(now: Date, count = 12): Date[] {
  const current = weekStartOf(now).getTime();
  return Array.from({ length: count }, (_, i) => new Date(current - (count - 1 - i) * WEEK_MS));
}

/**
 * "Needs your attention" count per week; null for a week without a bulletin (a gap in the
 * line, not a zero: no bulletin is not the same as nothing to do).
 */
export function attentionSeries(
  weeks: readonly Date[],
  bulletins: readonly { weekStart: Date; act: number }[]
): (number | null)[] {
  const byWeek = new Map(bulletins.map((b) => [weekStartOf(b.weekStart).getTime(), b.act]));
  return weeks.map((w) => byWeek.get(w.getTime()) ?? null);
}

export type SeverityBucket = "critical" | "high" | "moderate" | "low";

const BY_RANK: Record<number, SeverityBucket> = {
  4: "critical",
  3: "high",
  2: "moderate",
  1: "low",
};

export const SEVERITY_ORDER: readonly SeverityBucket[] = ["critical", "high", "moderate", "low"];

/**
 * Distinct advisories per severity. Unknown severity (none, or only a CVSS vector) counts
 * as high, the same reading as the same-day email threshold and the severity tags.
 */
export function severitySplit(
  alerts: readonly { advisoryId: string; severity: string | null }[]
): Record<SeverityBucket, number> {
  const seen = new Map<string, SeverityBucket>();
  for (const a of alerts) {
    if (seen.has(a.advisoryId)) continue;
    seen.set(a.advisoryId, BY_RANK[severityRank(a.severity)] ?? "high");
  }
  const out: Record<SeverityBucket, number> = { critical: 0, high: 0, moderate: 0, low: 0 };
  for (const bucket of seen.values()) out[bucket] += 1;
  return out;
}

/** The scheduler's weekly-bulletin slot: the next Monday 04:00 UTC after `now`. */
export function nextBulletinAt(now: Date): Date {
  const slot = new Date(weekStartOf(now).getTime() + 4 * 3_600_000);
  return slot.getTime() > now.getTime() ? slot : new Date(slot.getTime() + WEEK_MS);
}

export interface SparkPoint {
  /** Index of the week in the series. */
  index: number;
  x: number;
  y: number;
  value: number;
}

/**
 * Sparkline geometry: one point per week with a value, x evenly spaced over `width`, y from
 * 0 (bottom) to `max` (top, at least 1) inside `height`, with `pad` kept free top and bottom
 * for the marker. Consecutive points form segments; a null week breaks the line.
 */
export function sparkGeometry(
  values: readonly (number | null)[],
  width: number,
  height: number,
  pad = 4
): { segments: SparkPoint[][]; max: number } {
  const max = Math.max(1, ...values.map((v) => v ?? 0));
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const segments: SparkPoint[][] = [];
  let current: SparkPoint[] = [];
  values.forEach((value, i) => {
    if (value === null) {
      if (current.length > 0) segments.push(current);
      current = [];
      return;
    }
    const y = pad + (height - 2 * pad) * (1 - value / max);
    current.push({
      index: i,
      x: Math.round(i * step * 10) / 10,
      y: Math.round(y * 10) / 10,
      value,
    });
  });
  if (current.length > 0) segments.push(current);
  return { segments, max };
}
