"use client";

import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { distribute } from "@/lib/masonry";
import { cn } from "@/lib/utils";

export interface MasonryItem {
  key: string;
  /** Height guess in px for the server render, before the card can be measured. */
  estimate: number;
  node: ReactNode;
}

const GAP = 12;

/**
 * Two columns from 980px, filled shortest-first with each card's natural height (plain grid rows
 * would align cards across columns and leave gaps). The cards stay in their original DOM order,
 * so focus and screen readers keep the urgency order; from 980px each is placed explicitly on a
 * grid of 1px rows that may grow, so an estimate that is too small pushes content down instead of
 * overlapping it. The server places by estimate, the client again after measuring. Below 980px
 * it is a plain column and needs no JavaScript.
 */
export function Masonry({ items, className }: { items: MasonryItem[]; className?: string }) {
  const [measured, setMeasured] = useState<Record<string, number>>({});
  const nodes = useRef(new Map<string, HTMLElement>());
  const placements = distribute(
    items.map((it) => measured[it.key] ?? it.estimate),
    2,
    GAP
  );

  const keys = items.map((it) => it.key).join("|");
  useLayoutEffect(() => {
    const read = () => {
      // Below 980px the cards span the full width, so their heights say nothing about two columns.
      if (!window.matchMedia("(min-width: 980px)").matches) return;
      setMeasured((prev) => {
        let changed = false;
        const out: Record<string, number> = {};
        for (const [key, el] of nodes.current) {
          out[key] = el.offsetHeight;
          if (prev[key] !== out[key]) changed = true;
        }
        return changed ? out : prev;
      });
    };
    const observer = new ResizeObserver(read);
    for (const el of nodes.current.values()) observer.observe(el);
    return () => observer.disconnect();
    // Re-run when the set of cards changes so new ones are observed.
  }, [keys]);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 min-[980px]:grid min-[980px]:auto-rows-[minmax(1px,auto)] min-[980px]:grid-cols-2 min-[980px]:gap-x-3 min-[980px]:gap-y-0 min-[980px]:-mb-3",
        className
      )}
    >
      {items.map((item, i) => {
        const { column, top } = placements[i];
        const span = (measured[item.key] ?? item.estimate) + GAP;
        return (
          <div
            key={item.key}
            className="min-w-0 min-[980px]:[grid-column:var(--masonry-column)] min-[980px]:[grid-row:var(--masonry-row)]"
            style={
              {
                "--masonry-column": column + 1,
                "--masonry-row": `${top + 1} / span ${span}`,
              } as CSSProperties
            }
          >
            <div
              ref={(el) => {
                if (el) nodes.current.set(item.key, el);
                else nodes.current.delete(item.key);
              }}
            >
              {item.node}
            </div>
          </div>
        );
      })}
    </div>
  );
}
