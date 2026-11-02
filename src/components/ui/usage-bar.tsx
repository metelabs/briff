import { atLimit } from "@/lib/plans";
import { cn } from "@/lib/utils";

/**
 * One usage line with a bar: "Repos 8 / 10". Brand fill, ochre at the limit (never coral);
 * an unlimited plan shows the count without a bar. The text carries the numbers, so the bar
 * itself is hidden from screen readers.
 */
export function UsageBar({
  label,
  used,
  limit,
  flag = true,
}: {
  label: string;
  used: number;
  limit: number | null;
  /** Mark a reached limit; off for seats, which a one-person Free org always fills. */
  flag?: boolean;
}) {
  const full = flag && atLimit(used, limit);
  const share = limit === null || limit === 0 ? 0 : Math.min(1, used / limit);
  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
        <span>{label}</span>
        <span className={cn("tabular-nums", full && "text-upgrade font-medium")}>
          {limit === null ? `${used} · unlimited` : `${used} / ${limit}`}
        </span>
      </div>
      {limit !== null && (
        <div aria-hidden className="bg-surface-2 mt-1.5 h-1.5 overflow-hidden rounded-full">
          <div
            className={cn("h-full rounded-full", full ? "bg-upgrade" : "bg-brand")}
            style={{ width: `${Math.max(share * 100, used > 0 ? 3 : 0)}%` }}
          />
        </div>
      )}
    </div>
  );
}
