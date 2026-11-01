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

const DAY_MS = 86_400_000;

export interface WeekAttention {
  week: Date;
  /** Must-act items summed over the week's bulletins (all streams). */
  act: number;
  /** Good-to-know items summed over the week's bulletins. */
  know: number;
  /** Distinct advisories first raised as `new` alerts in the week. */
  alerts: number;
  /** At least one bulletin went out for the week. */
  bulletins: number;
}

/**
 * The home chart's weeks: attention summed across streams per week plus the week's new
 * advisories. Backlog alerts are left out: a first scan is not news.
 */
export function weeklyAttention(
  weeks: readonly Date[],
  bulletins: readonly { weekStart: Date; act: number; know: number }[],
  alerts: readonly { createdAt: Date; advisoryId: string; kind: string }[]
): WeekAttention[] {
  const index = new Map(weeks.map((w, i) => [w.getTime(), i]));
  const out: WeekAttention[] = weeks.map((week) => ({
    week,
    act: 0,
    know: 0,
    alerts: 0,
    bulletins: 0,
  }));
  for (const b of bulletins) {
    const i = index.get(weekStartOf(b.weekStart).getTime());
    if (i === undefined) continue;
    out[i].act += b.act;
    out[i].know += b.know;
    out[i].bulletins += 1;
  }
  const seen = weeks.map(() => new Set<string>());
  for (const a of alerts) {
    if (a.kind !== "new") continue;
    const i = index.get(weekStartOf(a.createdAt).getTime());
    if (i !== undefined) seen[i].add(a.advisoryId);
  }
  seen.forEach((ids, i) => (out[i].alerts = ids.size));
  return out;
}

/** The chart needs two weeks with a bulletin or a new alert before a trend means anything. */
export function hasTrend(series: readonly WeekAttention[]): boolean {
  return series.filter((w) => w.bulletins > 0 || w.alerts > 0).length >= 2;
}

export interface AlertState {
  advisoryId: string;
  severity: string | null;
  kind: string;
  createdAt: Date;
  reviewedAt: Date | null;
  resolvedAt: Date | null;
}

/**
 * Open at `at`: raised by then, not resolved and not reviewed (backlog) by then. The same
 * reading as the home counts today; a reopened alert only has its current state on record.
 */
export function isOpenAt(alert: AlertState, at: Date): boolean {
  const t = at.getTime();
  return (
    alert.createdAt.getTime() <= t &&
    (alert.resolvedAt === null || alert.resolvedAt.getTime() > t) &&
    (alert.reviewedAt === null || alert.reviewedAt.getTime() > t)
  );
}

export interface OpenAlerts {
  /** Distinct open advisories. */
  total: number;
  /** Of those, critical or high (unknown counts as high). */
  urgent: number;
  /** Open now minus open seven days ago. */
  delta: number;
  severity: Record<SeverityBucket, number>;
}

export function openAlerts(alerts: readonly AlertState[], now: Date): OpenAlerts {
  const weekAgo = new Date(now.getTime() - WEEK_MS);
  const open = alerts.filter((a) => isOpenAt(a, now));
  const severity = severitySplit(open);
  const before = new Set(alerts.filter((a) => isOpenAt(a, weekAgo)).map((a) => a.advisoryId));
  const total = SEVERITY_ORDER.reduce((n, s) => n + severity[s], 0);
  return { total, urgent: severity.critical + severity.high, delta: total - before.size, severity };
}

/** A repo is stale when its last scan is more than `days` old, or it has none. */
export function isStale(lastScannedAt: Date | null, now: Date, days = 7): boolean {
  return lastScannedAt === null || now.getTime() - lastScannedAt.getTime() > days * DAY_MS;
}

export type HealthBucket = "eol" | "major" | "minor" | "current";

export const HEALTH_ORDER: readonly HealthBucket[] = ["eol", "major", "minor", "current"];

/** Repos per drift bucket, each repo once by its most urgent finding (stack-drift urgency). */
export function stackHealth(drift: readonly { urgency: number }[]): Record<HealthBucket, number> {
  const out: Record<HealthBucket, number> = { eol: 0, major: 0, minor: 0, current: 0 };
  for (const r of drift) {
    out[
      r.urgency >= 3 ? "eol" : r.urgency === 2 ? "major" : r.urgency === 1 ? "minor" : "current"
    ] += 1;
  }
  return out;
}

/** "in 2d 5h", "in 3h 20m", "in 12m"; "now" once the slot has passed. */
export function countdown(now: Date, at: Date): string {
  const minutes = Math.floor((at.getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return "now";
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return `in ${d}d ${h}h`;
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}

/** "just now", "12m ago", "5h ago", "3d ago", then the date is enough. */
export function ago(now: Date, at: Date): string {
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Columns for the stream grid: 2 and 4 streams fill two columns evenly, others three. */
export function streamColumns(count: number): 1 | 2 | 3 {
  if (count <= 1) return 1;
  return count === 2 || count === 4 ? 2 : 3;
}

export type ActivityKind = "alert_resolved" | "bulletin_sent" | "repo_added" | "scan" | "member";

export interface Activity {
  kind: ActivityKind;
  at: Date;
  /** Stable tie-break and React key. */
  key: string;
  text: string;
  href: string;
}

/** Events closer than this to the previous one of the same kind fold into one line. */
export const FOLD_MS = 10 * 60_000;

/**
 * Folds runs of same-kind events (one scan upload of many repos, one resolution pass) into
 * one line: `label(n, first)` writes the folded text. Input order does not matter.
 */
export function foldBursts<T extends { at: Date; key: string }>(
  events: readonly T[],
  label: (group: T[]) => string,
  windowMs = FOLD_MS
): { at: Date; key: string; text: string; count: number }[] {
  const sorted = [...events].sort(byNewest);
  const groups: T[][] = [];
  for (const e of sorted) {
    const group = groups.at(-1);
    const last = group?.at(-1);
    if (group && last && last.at.getTime() - e.at.getTime() <= windowMs) group.push(e);
    else groups.push([e]);
  }
  return groups.map((g) => ({ at: g[0].at, key: g[0].key, text: label(g), count: g.length }));
}

/**
 * A repo's last scan, unless it is the upload that added the repo (the "added" event
 * already says so).
 */
export function isFollowUpScan(firstSeenAt: Date, lastScannedAt: Date | null): boolean {
  return lastScannedAt !== null && lastScannedAt.getTime() - firstSeenAt.getTime() > 60_000;
}

function byNewest(a: { at: Date; key: string }, b: { at: Date; key: string }): number {
  return b.at.getTime() - a.at.getTime() || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

/** Every source's events, newest first, the first `limit`. */
export function mergeActivity(sources: readonly (readonly Activity[])[], limit = 10): Activity[] {
  return sources.flat().sort(byNewest).slice(0, limit);
}

/** Top of the chart's y axis: a round, even number at or above `value` (at least 4). */
export function niceMax(value: number): number {
  const target = Math.max(4, Math.ceil(value));
  for (let scale = 1; ; scale *= 10) {
    for (const m of [4, 6, 8, 10, 12, 16, 20, 30, 40, 50, 60, 80]) {
      if (m * scale >= target) return m * scale;
    }
  }
}

/**
 * Ring segments for counts in order: each arc's drawn length (minus `gap` between arcs) and
 * its start along a circle of `circumference`. Zero counts get no arc.
 */
export function ringArcs<K extends string>(
  parts: readonly { key: K; count: number }[],
  circumference: number,
  gap: number
): { key: K; length: number; start: number }[] {
  const total = parts.reduce((n, p) => n + p.count, 0);
  const shown = parts.filter((p) => p.count > 0);
  const space = shown.length > 1 ? gap : 0;
  let start = 0;
  return shown.map((p) => {
    const share = (p.count / total) * circumference;
    const arc = { key: p.key, length: Math.max(0.5, share - space), start };
    start += share;
    return arc;
  });
}
