import type * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "@/lib/utils";

// DESIGN.md §8 Form field: 40px, surface, line border, radius 10; focus: brand border + soft ring.
// Errors never use coral (reserved for security): aria-invalid shows the upgrade colour.
export const fieldControlClass =
  "border-line bg-surface text-fg placeholder:text-fg-subtle w-full min-w-0 rounded-control border px-3 text-[14px] transition-[border-color,box-shadow] duration-150 outline-none focus:border-brand focus:shadow-[0_0_0_3px_var(--brand-soft)] focus-visible:outline-none disabled:opacity-45 aria-invalid:border-upgrade";

function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      data-slot="input"
      className={cn(fieldControlClass, "h-10", className)}
      {...props}
    />
  );
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldControlClass, "resize-y py-2.5 leading-normal", className)}
      {...props}
    />
  );
}

function Select({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cn(fieldControlClass, "h-10 pr-8", className)} {...props} />;
}

export { Input, Select, Textarea };
