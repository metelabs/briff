"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

import { fieldControlClass } from "./input";

export interface SelectOption<V extends string> {
  value: V;
  label: string;
}

// DESIGN.md §8 Form field (trigger) + the account menu's popup: no native <select> chrome.
// z-80 so it opens above dialogs (z-70).
export function Select<V extends string>({
  id,
  name,
  options,
  value,
  defaultValue,
  onValueChange,
  autoFocus,
  className,
  "aria-label": ariaLabel,
}: {
  id?: string;
  name?: string;
  options: readonly SelectOption<V>[];
  value?: V;
  defaultValue?: V;
  onValueChange?: (value: V) => void;
  autoFocus?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <SelectPrimitive.Root<V>
      id={id}
      name={name}
      items={options}
      value={value}
      defaultValue={defaultValue}
      onValueChange={(next) => {
        if (next !== null) onValueChange?.(next);
      }}
    >
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        className={cn(
          fieldControlClass,
          "data-popup-open:border-brand flex h-10 cursor-default items-center justify-between gap-2 text-left select-none data-popup-open:shadow-[0_0_0_3px_var(--brand-soft)]",
          className
        )}
      >
        <SelectPrimitive.Value className="min-w-0 truncate" />
        <SelectPrimitive.Icon className="text-fg-muted shrink-0 transition-transform duration-150 ease-out [[data-popup-open]_&]:rotate-180">
          <ChevronDown className="size-4" aria-hidden />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          className="z-80 outline-none"
          sideOffset={6}
          collisionPadding={12}
          alignItemWithTrigger={false}
        >
          <SelectPrimitive.Popup className="bg-surface text-fg border-line shadow-raised max-h-[var(--available-height)] max-w-[var(--available-width)] min-w-[var(--anchor-width)] origin-[var(--transform-origin)] overflow-y-auto rounded-[14px] border p-1.5 transition-[opacity,scale] duration-[180ms] ease-out outline-none data-ending-style:scale-[.98] data-ending-style:opacity-0 data-ending-style:duration-[120ms] data-starting-style:scale-[.98] data-starting-style:opacity-0">
            <SelectPrimitive.List>
              {options.map((o) => (
                <SelectPrimitive.Item
                  key={o.value}
                  value={o.value}
                  className="data-highlighted:bg-surface-2 grid min-h-9 cursor-default grid-cols-[16px_1fr] items-center gap-2 rounded-[9px] px-2.5 py-2 text-[14px] outline-none select-none"
                >
                  <SelectPrimitive.ItemIndicator className="col-start-1 flex">
                    <Check className="size-4" aria-hidden />
                  </SelectPrimitive.ItemIndicator>
                  <SelectPrimitive.ItemText className="col-start-2">
                    {o.label}
                  </SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
