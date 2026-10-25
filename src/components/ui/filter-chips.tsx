"use client";

import Link from "next/link";
import { useRef, type KeyboardEvent, type ReactNode } from "react";

const chipClass =
  "bg-surface border-line text-fg-muted hover:border-line-strong hover:text-fg aria-pressed:bg-brand-soft aria-pressed:text-brand aria-pressed:border-brand aria-[current=page]:bg-brand-soft aria-[current=page]:text-brand aria-[current=page]:border-brand inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium whitespace-nowrap transition-colors duration-150";

function Count({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[11.5px] opacity-80">{children}</span>;
}

/** Filter chips with counts; arrow keys move between them (DESIGN.md §10). */
export function FilterChips<V extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: V; label: string; count?: number }[];
  value: V;
  onChange: (value: V) => void;
  label: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
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
          className={chipClass}
        >
          {o.label}
          {o.count !== undefined && <Count>{o.count}</Count>}
        </button>
      ))}
    </div>
  );
}

/** The same chips as links, for filters that live in the URL. */
export function FilterLinks({
  options,
  label,
}: {
  options: readonly { href: string; label: string; count?: number; current: boolean }[];
  label: string;
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-2">
      {options.map((o) => (
        <Link
          key={o.href}
          href={o.href}
          aria-current={o.current ? "page" : undefined}
          className={chipClass}
        >
          {o.label}
          {o.count !== undefined && <Count>{o.count}</Count>}
        </Link>
      ))}
    </nav>
  );
}
