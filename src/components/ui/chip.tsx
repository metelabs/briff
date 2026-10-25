import type * as React from "react";

import { cn } from "@/lib/utils";

const chipClass =
  "bg-surface-2 border-line inline-flex max-w-full min-w-0 items-center rounded-chip border px-2 py-[3px] font-mono text-[12px] leading-[1.4] whitespace-nowrap";

/** Repo or package name chip (mono). */
export function Chip({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn(chipClass, className)} {...props} />;
}

/** A chip that does something: hover shows the brand border and tint. */
export function ChipButton({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        chipClass,
        "hover:border-brand hover:bg-brand-soft transition-colors duration-150",
        className
      )}
      {...props}
    />
  );
}
