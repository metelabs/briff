"use client";

import { Search } from "lucide-react";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/** Search input; `/` focuses it from anywhere on the page (DESIGN.md §10). */
export function SearchField({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        active.closest("input, textarea, select, [contenteditable]")
      )
        return;
      e.preventDefault();
      ref.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <label
      className={cn(
        "bg-surface border-line focus-within:border-brand rounded-control flex h-9 min-w-0 flex-[0_1_260px] items-center gap-2 border px-2.5 transition-[border-color,box-shadow] duration-150 focus-within:shadow-[0_0_0_3px_var(--brand-soft)] max-[560px]:basis-full",
        className
      )}
    >
      <Search aria-hidden className="text-fg-muted size-[15px] shrink-0" />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="placeholder:text-fg-subtle min-w-0 flex-1 bg-transparent text-[13.5px] outline-none focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      <kbd className="text-fg-muted border-line rounded-[4px] border px-[5px] font-mono text-[11px] max-[560px]:hidden">
        /
      </kbd>
    </label>
  );
}
