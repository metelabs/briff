"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useId,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";

import {
  INITIAL_TOOLTIP,
  isCut,
  tooltipReducer,
  truncatedTooltip,
  type TooltipEvent,
  type TooltipState,
} from "./tooltip-state";

// DESIGN.md §8 Tooltip: inverted (fg on surface), radius 8, 12.5px, max 320px; 300ms open delay.
const popupClass =
  "bg-fg text-surface shadow-raised z-80 max-w-[min(320px,calc(100vw-32px))] origin-[var(--transform-origin)] rounded-[8px] px-2.5 py-1.5 text-[12.5px] leading-[1.4] break-words transition-[opacity,scale] duration-[120ms] ease-out data-ending-style:scale-[.98] data-ending-style:opacity-0 data-instant:duration-0 data-starting-style:scale-[.98] data-starting-style:opacity-0";

export const TOOLTIP_DELAY = 300;

/**
 * Design-system tooltip, replacing the browser's `title=`. Opens on hover after a short delay
 * and on keyboard focus (the trigger must be focusable); on touch a tap toggles it and a tap
 * elsewhere closes it. `children` is the trigger element.
 *
 * Tooltips are not read by screen readers, so unless the trigger already holds the same text
 * (`describe={false}`), the content is also linked as the trigger's description.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  disabled = false,
  describe = true,
  toggleOnTap = true,
}: {
  content: ReactNode;
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
  disabled?: boolean;
  describe?: boolean;
  /** Off for triggers whose tap already does something visible (a menu trigger). */
  toggleOnTap?: boolean;
}) {
  const [state, dispatch] = useReducer(
    (current: TooltipState, event: TooltipEvent) =>
      tooltipReducer(current, event, { disabled, toggleOnTap }),
    INITIAL_TOOLTIP
  );
  const descriptionId = useId();
  const described = describe && !disabled;

  return (
    <>
      <TooltipPrimitive.Root
        open={state.open && !disabled}
        onOpenChange={(open) => dispatch({ type: "primitive", open })}
        disabled={disabled}
      >
        <TooltipPrimitive.Trigger
          delay={TOOLTIP_DELAY}
          closeOnClick={false}
          render={children}
          {...(described && { "aria-describedby": descriptionId })}
          onPointerDown={(event) =>
            dispatch({ type: "pointerdown", pointerType: event.pointerType })
          }
          onClick={() => dispatch({ type: "click" })}
        />
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Positioner side={side} sideOffset={6} className="z-80">
            <TooltipPrimitive.Popup className={popupClass}>{content}</TooltipPrimitive.Popup>
          </TooltipPrimitive.Positioner>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
      {described && (
        <span id={descriptionId} hidden>
          {content}
        </span>
      )}
    </>
  );
}

/** Whether the element's single-line text is cut by its width; follows resizes. */
export function useIsTruncated<T extends HTMLElement>(text: ReactNode) {
  const ref = useRef<T>(null);
  const [cut, setCut] = useState(false);
  const measure = useCallback(() => {
    const el = ref.current;
    if (el) setCut(isCut(el));
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, text]);

  return { ref, cut };
}

/**
 * Single-line text cut with an ellipsis. When the text is actually cut, or `full` says more than
 * the visible text (an abbreviation like "4 repos"), it becomes focusable and shows the full
 * text in a tooltip.
 */
export function TruncatedText({
  children,
  full,
  className,
  as: Tag = "span",
  focusable = true,
}: {
  children: ReactNode;
  full?: ReactNode;
  className?: string;
  as?: "span" | "b";
  /** Off inside a menu popup, where Tab would leave the menu; hover still shows it. */
  focusable?: boolean;
}) {
  const { ref, cut } = useIsTruncated<HTMLElement>(children);
  const { active, tabStop } = truncatedTooltip(cut, full !== undefined, focusable);
  return (
    <Tooltip content={full ?? children} disabled={!active} describe={full !== undefined}>
      <Tag
        ref={ref}
        tabIndex={tabStop ? 0 : undefined}
        className={cn("block min-w-0 truncate", active && "cursor-default", className)}
      >
        {children}
      </Tag>
    </Tooltip>
  );
}
