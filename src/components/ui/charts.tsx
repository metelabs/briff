"use client";

import { isoWeekLabel } from "@/pipeline/bulletin";
import { SEVERITY_ORDER, sparkGeometry, type SeverityBucket } from "@/pipeline/home";
import { cn } from "@/lib/utils";

import { Tooltip } from "./tooltip";

// Inline SVG charts drawn with the design tokens (no chart library). Only where a chart says
// more than a number: the 12-week attention trend per stream and the backlog's severities.

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
      <table className="sr-only">
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
    </figure>
  );
}

const SEVERITY_FILL: Record<SeverityBucket, string> = {
  critical: "bg-sec",
  high: "bg-[color-mix(in_srgb,var(--sec)_55%,var(--surface))]",
  moderate: "bg-upgrade",
  low: "bg-wait",
};

/**
 * Backlog advisories by severity as one stacked bar (2px surface gaps, rounded ends) with a
 * text legend: the words and counts carry the meaning, the colours follow DESIGN.md §3.
 */
export function SeverityBar({ counts }: { counts: Record<SeverityBucket, number> }) {
  const total = SEVERITY_ORDER.reduce((n, s) => n + counts[s], 0);
  if (total === 0) return null;
  const parts = SEVERITY_ORDER.filter((s) => counts[s] > 0);
  return (
    <figure>
      <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-[4px]" aria-hidden>
        {parts.map((s) => (
          <Tooltip key={s} describe={false} content={`${counts[s]} ${s}`}>
            <span
              className={cn("h-full min-w-1.5", SEVERITY_FILL[s])}
              style={{ flexGrow: counts[s], flexBasis: 0 }}
            />
          </Tooltip>
        ))}
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px]">
        {parts.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <i aria-hidden className={cn("size-2 rounded-full", SEVERITY_FILL[s])} />
            <b className="font-semibold tabular-nums">{counts[s]}</b>
            <span className="text-fg-muted">{s}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
