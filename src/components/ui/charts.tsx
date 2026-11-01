"use client";

import { isoWeekLabel } from "@/pipeline/bulletin";
import {
  niceMax,
  ringArcs,
  SEVERITY_ORDER,
  sparkGeometry,
  type SeverityBucket,
  type WeekAttention,
} from "@/pipeline/home";
import { cn } from "@/lib/utils";

import { Tooltip } from "./tooltip";

// Inline SVG/HTML charts drawn with the design tokens (no chart library): the home page's
// attention trend, the per-stream sparkline, the severity donut and the share bars.

const W = 240;
const H = 44;

/**
 * 12-week "needs your attention" line for one stream: a 2px brand line, gaps for weeks
 * without a bulletin, the current week marked and labelled, first and last week named below.
 * Each week is hoverable; a hidden table carries the same numbers for screen readers.
 */
export function AttentionSparkline({
  weeks,
  values,
  label,
}: {
  weeks: readonly Date[];
  values: readonly (number | null)[];
  label: string;
}) {
  const { segments, max } = sparkGeometry(values, W, H, 5);
  const last = segments.at(-1)?.at(-1);
  const lastIsCurrent = values.at(-1) !== null;
  const step = 100 / Math.max(1, values.length - 1);
  return (
    <figure className="min-w-0">
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="block h-11 w-full overflow-visible"
          aria-hidden
        >
          <line
            x1={0}
            x2={W}
            y1={H - 5}
            y2={H - 5}
            stroke="var(--line)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          {segments.map((seg, i) =>
            seg.length > 1 ? (
              <polyline
                key={i}
                points={seg.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke="var(--brand)"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ) : null
          )}
        </svg>
        {/* Markers in HTML so they stay round on the stretched SVG; they double as hover targets. */}
        {segments.flat().map((point) => {
          const v = point.value;
          const isLast = point === last && lastIsCurrent;
          const lone = segments.some((s) => s.length === 1 && s[0] === point);
          return (
            <Tooltip
              key={point.index}
              describe={false}
              content={`${isoWeekLabel(weeks[point.index])}: ${v} need${v === 1 ? "s" : ""} your attention`}
            >
              <span
                className="absolute grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center"
                style={{ left: `${point.index * step}%`, top: `${(point.y / H) * 100}%` }}
              >
                <i
                  className={cn(
                    "block rounded-full",
                    isLast || lone ? "bg-brand ring-surface size-2.5 ring-2" : "size-2"
                  )}
                />
              </span>
            </Tooltip>
          );
        })}
      </div>
      <figcaption className="text-fg-muted mt-1 flex justify-between font-mono text-[11.5px] tabular-nums">
        <span>{isoWeekLabel(weeks[0]).slice(5)}</span>
        <span>max {max}</span>
        <span>{isoWeekLabel(weeks.at(-1) ?? weeks[0]).slice(5)}</span>
      </figcaption>
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <tbody>
            {weeks.map((w, i) => (
              <tr key={w.toISOString()}>
                <th scope="row">{isoWeekLabel(w)}</th>
                <td>{values[i] ?? "no bulletin"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

export const SEVERITY_COLOR: Record<SeverityBucket, string> = {
  critical: "var(--sec)",
  high: "color-mix(in srgb, var(--sec) 55%, var(--surface))",
  moderate: "var(--upgrade)",
  low: "var(--wait)",
};

export interface SharePart {
  key: string;
  label: string;
  count: number;
  color: string;
}

/**
 * Parts of a whole as one stacked bar (2px surface gaps, rounded ends) with a text legend:
 * the words and counts carry the meaning, the colours follow DESIGN.md §3.
 */
export function ShareBar({
  parts,
  className,
}: {
  parts: readonly SharePart[];
  className?: string;
}) {
  const shown = parts.filter((p) => p.count > 0);
  if (shown.length === 0) return null;
  return (
    <figure className={className}>
      <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-[4px]" aria-hidden>
        {shown.map((p) => (
          <Tooltip key={p.key} describe={false} content={`${p.count} ${p.label}`}>
            <span
              className="h-full min-w-1.5"
              style={{ flexGrow: p.count, flexBasis: 0, background: p.color }}
            />
          </Tooltip>
        ))}
      </div>
      <Legend parts={parts} className="mt-2.5" />
    </figure>
  );
}

function Legend({ parts, className }: { parts: readonly SharePart[]; className?: string }) {
  return (
    <figcaption className={cn("flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px]", className)}>
      {parts.map((p) => (
        <span key={p.key} className="inline-flex items-center gap-1.5">
          <i aria-hidden className="size-2 rounded-full" style={{ background: p.color }} />
          <b className="font-semibold tabular-nums">{p.count}</b>
          <span className="text-fg-muted">{p.label}</span>
        </span>
      ))}
    </figcaption>
  );
}

/** Advisories by severity as a share bar (critical → low). */
export function SeverityBar({ counts }: { counts: Record<SeverityBucket, number> }) {
  return (
    <ShareBar
      parts={SEVERITY_ORDER.filter((s) => counts[s] > 0).map((s) => ({
        key: s,
        label: s,
        count: counts[s],
        color: SEVERITY_COLOR[s],
      }))}
    />
  );
}

const DONUT_R = 46;
const DONUT_C = 2 * Math.PI * DONUT_R;

/**
 * Advisories by severity as a ring: total in the middle, one arc per severity with a 2px
 * surface gap, the legend beside it with every count (the ring alone never carries a number).
 */
export function SeverityDonut({
  counts,
  caption,
}: {
  counts: Record<SeverityBucket, number>;
  caption: string;
}) {
  const total = SEVERITY_ORDER.reduce((n, s) => n + counts[s], 0);
  const parts = SEVERITY_ORDER.map((s) => ({
    key: s,
    label: s,
    count: counts[s],
    color: SEVERITY_COLOR[s],
  }));
  const arcs = ringArcs(parts, DONUT_C, 2.5);
  return (
    <figure className="flex items-center gap-5">
      <div className="relative size-[112px] shrink-0">
        <svg viewBox="0 0 112 112" className="size-full -rotate-90" aria-hidden>
          <circle
            cx={56}
            cy={56}
            r={DONUT_R}
            fill="none"
            stroke="var(--surface-2)"
            strokeWidth={12}
          />
          {arcs.map((arc) => (
            <circle
              key={arc.key}
              cx={56}
              cy={56}
              r={DONUT_R}
              fill="none"
              stroke={SEVERITY_COLOR[arc.key]}
              strokeWidth={12}
              strokeDasharray={`${arc.length} ${DONUT_C}`}
              strokeDashoffset={-arc.start}
            />
          ))}
        </svg>
        <div className="absolute inset-0 grid place-content-center text-center">
          <b className="type-stat text-[28px]">{total}</b>
          <span className="text-fg-muted text-[11.5px]">{caption}</span>
        </div>
      </div>
      <figcaption className="grid min-w-0 gap-1.5 text-[13px]">
        {parts.map((p) => (
          <span key={p.key} className="flex items-center gap-2">
            <i
              aria-hidden
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: p.color }}
            />
            <span className="text-fg-muted w-[68px]">{p.label}</span>
            <b className="font-semibold tabular-nums">{p.count}</b>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

const ACT_COLOR = "var(--brand)";
const KNOW_COLOR = "color-mix(in srgb, var(--brand) 38%, var(--surface))";
const ALERT_COLOR = "var(--sec)";

/**
 * The home trend: per week, stacked bars of must-act and good-to-know items across streams,
 * and a coral line of new advisories, on one shared count axis. Each week is a hover and
 * focus target with a tooltip; a hidden table carries the numbers for screen readers.
 */
export function AttentionChart({ series }: { series: readonly WeekAttention[] }) {
  const max = niceMax(Math.max(...series.map((w) => Math.max(w.act + w.know, w.alerts))));
  const n = series.length;
  const pct = (v: number) => (v / max) * 100;
  const points = series.map((w, i) => ({ x: ((i + 0.5) / n) * 100, y: 100 - pct(w.alerts) }));
  const totals = series.reduce(
    (t, w) => ({ act: t.act + w.act, know: t.know + w.know, alerts: t.alerts + w.alerts }),
    { act: 0, know: 0, alerts: 0 }
  );
  return (
    <figure className="min-w-0">
      <figcaption className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px]">
        <LegendKey color={ACT_COLOR} label="must act" total={totals.act} />
        <LegendKey color={KNOW_COLOR} label="good to know" total={totals.know} />
        <LegendKey color={ALERT_COLOR} label="new alerts" total={totals.alerts} line />
        <span className="text-fg-muted ml-auto">12 weeks, all streams</span>
      </figcaption>
      <div className="flex gap-2">
        <div
          aria-hidden
          className="text-fg-muted relative w-6 shrink-0 font-mono text-[11px] tabular-nums"
        >
          {[max, max / 2, 0].map((t, i) => (
            <span
              key={t}
              className="absolute right-0 -translate-y-1/2"
              style={{ top: `${i * 50}%` }}
            >
              {t}
            </span>
          ))}
        </div>
        <div className="relative h-[180px] min-w-0 flex-1">
          {[0, 50, 100].map((top) => (
            <div
              key={top}
              aria-hidden
              className={cn(
                "absolute inset-x-0 border-t",
                top === 100 ? "border-line-strong" : "border-line border-dashed"
              )}
              style={{ top: `${top}%` }}
            />
          ))}
          <div className="absolute inset-0 flex">
            {series.map((w, i) => (
              <Tooltip key={w.week.toISOString()} describe={false} content={<WeekTip week={w} />}>
                <span
                  tabIndex={0}
                  aria-label={weekSentence(w)}
                  className={cn(
                    "group relative flex h-full flex-1 flex-col-reverse items-center rounded-[6px] outline-offset-0 transition-colors duration-150",
                    "hover:bg-surface-2 focus-visible:bg-surface-2",
                    i === n - 1 && "bg-brand-soft/40"
                  )}
                >
                  {w.act > 0 && (
                    <i
                      className={cn("block w-[46%] max-w-7", w.know === 0 && "rounded-t-[4px]")}
                      style={{ height: `${pct(w.act)}%`, background: ACT_COLOR }}
                    />
                  )}
                  {w.know > 0 && (
                    <i
                      className="block w-[46%] max-w-7 rounded-t-[4px]"
                      style={{
                        height: `${pct(w.know)}%`,
                        background: KNOW_COLOR,
                        marginBottom: w.act > 0 ? 2 : 0,
                      }}
                    />
                  )}
                </span>
              </Tooltip>
            ))}
          </div>
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 size-full overflow-visible"
            aria-hidden
          >
            {/* Flat runs of zero would sit on the axis; only stretches with alerts are drawn. */}
            {points
              .slice(1)
              .map((p, i) =>
                series[i].alerts > 0 || series[i + 1].alerts > 0 ? (
                  <line
                    key={i}
                    x1={points[i].x}
                    y1={points[i].y}
                    x2={p.x}
                    y2={p.y}
                    stroke={ALERT_COLOR}
                    strokeWidth={2}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null
              )}
          </svg>
          {points.map((p, i) =>
            series[i].alerts > 0 ? (
              <i
                key={i}
                aria-hidden
                className="ring-surface pointer-events-none absolute block size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2"
                style={{ left: `${p.x}%`, top: `${p.y}%`, background: ALERT_COLOR }}
              />
            ) : null
          )}
        </div>
      </div>
      <div aria-hidden className="text-fg-muted mt-2 ml-8 flex font-mono text-[11px] tabular-nums">
        {series.map((w, i) => (
          <span
            key={w.week.toISOString()}
            className={cn(
              "flex-1 text-center",
              i === n - 1 && "text-fg font-medium",
              (n - 1 - i) % 2 === 1 && "max-[560px]:invisible"
            )}
          >
            {isoWeekLabel(w.week).slice(5)}
          </span>
        ))}
      </div>
      <div className="sr-only">
        <table>
          <caption>Needs your attention, good to know and new alerts per week, all streams</caption>
          <thead>
            <tr>
              <th scope="col">Week</th>
              <th scope="col">Must act</th>
              <th scope="col">Good to know</th>
              <th scope="col">New alerts</th>
            </tr>
          </thead>
          <tbody>
            {series.map((w) => (
              <tr key={w.week.toISOString()}>
                <th scope="row">{isoWeekLabel(w.week)}</th>
                <td>{w.bulletins > 0 ? w.act : "no bulletin"}</td>
                <td>{w.bulletins > 0 ? w.know : "no bulletin"}</td>
                <td>{w.alerts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function weekSentence(w: WeekAttention): string {
  const items = w.bulletins > 0 ? `${w.act} must act, ${w.know} good to know` : "no bulletin";
  return `${isoWeekLabel(w.week)}: ${items}, ${w.alerts} new alert${w.alerts === 1 ? "" : "s"}`;
}

function WeekTip({ week: w }: { week: WeekAttention }) {
  return (
    <span className="grid gap-0.5 tabular-nums">
      <b className="font-semibold">{isoWeekLabel(w.week)}</b>
      {w.bulletins > 0 ? (
        <>
          <span>{w.act} must act</span>
          <span>{w.know} good to know</span>
        </>
      ) : (
        <span>No bulletin</span>
      )}
      <span>
        {w.alerts} new alert{w.alerts === 1 ? "" : "s"}
      </span>
    </span>
  );
}

function LegendKey({
  color,
  label,
  total,
  line = false,
}: {
  color: string;
  label: string;
  total: number;
  line?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i
        aria-hidden
        className={line ? "h-0.5 w-3.5 rounded-full" : "size-2.5 rounded-[3px]"}
        style={{ background: color }}
      />
      <span className="text-fg-muted">{label}</span>
      <b className="font-semibold tabular-nums">{total}</b>
    </span>
  );
}
