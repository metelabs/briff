import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A list that shows its first `limit` rows and folds the rest behind "Show N more"
 * (a native <details>, so it works without JS and keeps its rows in the page).
 */
export function CollapsedList({
  rows,
  limit = 5,
  moreLabel,
  className,
  listClassName = "grid gap-2",
  rowClassName,
}: {
  rows: { key: string; node: ReactNode }[];
  limit?: number;
  /** Closed summary text; default "Show N more". */
  moreLabel?: (hidden: number, total: number) => string;
  className?: string;
  /** Layout of both row lists (the shown and the folded rows). */
  listClassName?: string;
  rowClassName?: string;
}) {
  const shown = rows.slice(0, limit);
  const hidden = rows.slice(limit);
  const label = moreLabel ?? ((n: number) => `Show ${n} more`);
  return (
    <div className={className}>
      <ul className={listClassName}>
        {shown.map((r) => (
          <li key={r.key} className={cn("min-w-0", rowClassName)}>
            {r.node}
          </li>
        ))}
      </ul>
      {hidden.length > 0 && (
        <details className="group/more">
          <summary className="text-brand mt-1.5 w-fit cursor-pointer text-[12.5px] font-medium underline-offset-4 marker:content-none hover:underline">
            <span className="group-open/more:hidden">{label(hidden.length, rows.length)}</span>
            <span className="hidden group-open/more:inline">Show fewer</span>
          </summary>
          <ul className={cn("mt-2", listClassName)}>
            {hidden.map((r) => (
              <li key={r.key} className={cn("min-w-0", rowClassName)}>
                {r.node}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
