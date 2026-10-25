"use client";

import { useRef, type KeyboardEvent } from "react";

import { cn } from "@/lib/utils";

/**
 * Segmented control for views of the same data (DESIGN.md §8 Tabs): a brand indicator
 * slides under the active option; arrow keys move between options (roving tabindex).
 */
export function Segmented<V extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: readonly { value: V; label: string }[];
  value: V;
  onChange: (value: V) => void;
  label: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "bg-surface border-line rounded-control relative inline-grid border p-[3px]",
        className
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden
        className="bg-brand ease-indicator absolute top-[3px] bottom-[3px] left-[3px] rounded-[7px] transition-transform duration-300"
        style={{
          width: `calc((100% - 6px) / ${options.length})`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          aria-pressed={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
          className="text-fg-muted aria-pressed:text-on-brand relative z-1 min-h-[34px] rounded-[7px] px-4 font-medium whitespace-nowrap transition-colors duration-200"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
