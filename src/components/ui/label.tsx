import type * as React from "react";

import { cn } from "@/lib/utils";

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn("text-fg text-[13px] leading-snug font-medium", className)}
      {...props}
    />
  );
}

/** Help text under a field (12.5px muted). */
function FieldHelp({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-fg-muted text-[12.5px]", className)} {...props} />;
}

/**
 * Form status line. Failures use the upgrade colour, never coral (DESIGN.md §8 Form field).
 */
function FormStatus({ ok, message }: { ok: boolean; message: string | null }) {
  if (!message) return null;
  return (
    <p role="status" className={cn("text-[13px]", ok ? "text-fg-muted" : "text-upgrade")}>
      {message}
    </p>
  );
}

export { FieldHelp, FormStatus, Label };
