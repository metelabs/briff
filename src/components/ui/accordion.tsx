"use client";

import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface AccordionEntry {
  id: string;
  title: ReactNode;
  body: ReactNode;
}

/**
 * Rows inside one surface card (DESIGN.md §8 Know row look), several may be open. Closed panels
 * stay in the page (`hiddenUntilFound`), so find-in-page and crawlers still see the answers.
 */
export function Accordion({
  entries,
  defaultOpen = [],
  className,
}: {
  entries: readonly AccordionEntry[];
  defaultOpen?: string[];
  className?: string;
}) {
  return (
    <AccordionPrimitive.Root
      multiple
      hiddenUntilFound
      defaultValue={defaultOpen}
      className={cn("bg-surface border-line rounded-card border", className)}
    >
      {entries.map((entry) => (
        <AccordionPrimitive.Item
          key={entry.id}
          value={entry.id}
          className="border-line border-t first:border-t-0"
        >
          <AccordionPrimitive.Header className="m-0">
            <AccordionPrimitive.Trigger className="group hover:bg-surface-2/60 rounded-card flex w-full items-center justify-between gap-4 px-[18px] py-4 text-left text-[15px] font-medium transition-colors duration-[120ms] focus-visible:-outline-offset-2">
              {entry.title}
              <ChevronDown
                aria-hidden
                className="text-fg-muted size-4 shrink-0 transition-transform duration-[280ms] ease-[var(--ease-entrance)] group-data-panel-open:rotate-180"
              />
            </AccordionPrimitive.Trigger>
          </AccordionPrimitive.Header>
          <AccordionPrimitive.Panel className="h-[var(--accordion-panel-height)] overflow-hidden transition-[height] duration-[280ms] ease-[var(--ease-entrance)] data-ending-style:h-0 data-starting-style:h-0">
            <div className="text-fg-muted px-[18px] pb-4 text-[14px]">{entry.body}</div>
          </AccordionPrimitive.Panel>
        </AccordionPrimitive.Item>
      ))}
    </AccordionPrimitive.Root>
  );
}
