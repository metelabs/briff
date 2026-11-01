"use client";

import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

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
 * Two columns from 980px, filled shortest-first with each card's natural height (CSS grid rows
 * would align cards across columns and leave gaps). The server splits by estimate; the client
 * re-splits after measuring. Below 980px the column wrappers are `display: contents` and `order`
 * restores the original sequence, so one column reads in order without JavaScript.
 */
export function Masonry({ items, className }: { items: MasonryItem[]; className?: string }) {
  const [measured, setMeasured] = useState<Record<string, number>>({});
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const observer = useRef<ResizeObserver | null>(null);
  const columns = distribute(
    items.map((it) => measured[it.key] ?? it.estimate),
    2,
    GAP
  );

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
    const ro = new ResizeObserver(read);
    observer.current = ro;
    for (const el of nodes.current.values()) ro.observe(el);
    return () => {
      ro.disconnect();
      observer.current = null;
    };
  }, []);

  return (
    <div
      className={cn("flex flex-col gap-3 min-[980px]:flex-row min-[980px]:items-start", className)}
    >
      {columns.map((col, c) => (
        <div
          key={c}
          className="contents min-[980px]:flex min-[980px]:min-w-0 min-[980px]:flex-1 min-[980px]:flex-col min-[980px]:gap-3"
        >
          {col.map((i) => {
            const item = items[i];
            return (
              <div
                key={item.key}
                style={{ order: i }}
                className="min-w-0"
                ref={(el) => {
                  // A card that moves column remounts, so it is (re)observed here.
                  if (el) {
                    nodes.current.set(item.key, el);
                    observer.current?.observe(el);
                    return () => {
                      observer.current?.unobserve(el);
                      if (nodes.current.get(item.key) === el) nodes.current.delete(item.key);
                    };
                  }
                }}
              >
                {item.node}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
