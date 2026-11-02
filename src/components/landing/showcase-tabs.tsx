"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface ShowcaseTab {
  id: string;
  label: string;
  caption: string;
  panel: ReactNode;
}

/**
 * The landing page's product tour: a tab list over real screens rendered on the server.
 * Every panel stays in the DOM (hidden ones with `hidden`), so switching is instant and
 * the screens are there without JavaScript's help for the first one.
 */
export function ShowcaseTabs({ tabs }: { tabs: ShowcaseTab[] }) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const base = useId();
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step =
      e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "Home" ? -i : 0;
    const last = e.key === "End" ? tabs.length - 1 - i : 0;
    if (!step && !last) return;
    e.preventDefault();
    const next = (i + step + last + tabs.length) % tabs.length;
    setActive(next);
    refs.current[next]?.focus();
  };
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div
          role="tablist"
          aria-label="Product screens"
          className="bg-surface border-line rounded-control relative grid w-full grid-cols-4 border p-[3px] min-[560px]:w-auto"
        >
          <span
            aria-hidden
            className="bg-brand ease-indicator absolute top-[3px] bottom-[3px] left-[3px] rounded-[7px] transition-transform duration-300"
            style={{
              width: `calc((100% - 6px) / ${tabs.length})`,
              transform: `translateX(${active * 100}%)`,
            }}
          />
          {tabs.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              id={`${base}-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-controls={`${base}-panel-${t.id}`}
              tabIndex={i === active ? 0 : -1}
              onClick={() => setActive(i)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                "relative z-[1] min-h-9 rounded-[7px] px-2 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 min-[560px]:px-4 min-[560px]:text-[14px]",
                i === active ? "text-on-brand" : "text-fg-muted hover:text-fg"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="text-fg-muted text-[14px]" aria-live="polite">
          {tabs[active].caption}
        </p>
      </div>
      {tabs.map((t, i) => (
        <div
          key={t.id}
          id={`${base}-panel-${t.id}`}
          role="tabpanel"
          aria-labelledby={`${base}-tab-${t.id}`}
          hidden={i !== active}
          className="mt-4"
        >
          {t.panel}
        </div>
      ))}
    </div>
  );
}
