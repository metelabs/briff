"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

// 16px box: line-strong border on surface; checked = brand fill with an on-brand tick.
export function Checkbox({
  className,
  ...props
}: Omit<CheckboxPrimitive.Root.Props, "className"> & { className?: string }) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "border-line-strong bg-surface text-on-brand data-checked:border-brand data-checked:bg-brand grid size-4 shrink-0 place-items-center rounded-[5px] border transition-colors duration-[120ms]",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex data-unchecked:hidden">
        <Check className="size-3" strokeWidth={3} aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
