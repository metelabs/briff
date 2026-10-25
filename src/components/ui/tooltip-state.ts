// Pure parts of the tooltip (tooltip.tsx), kept apart so they can be tested without a DOM.

/** Whether single-line text is cut by its box (1px of slack for subpixel rounding). */
export function isCut(size: { scrollWidth: number; clientWidth: number }): boolean {
  return size.scrollWidth > size.clientWidth + 1;
}

/** A TruncatedText shows a tooltip when its text is cut or abbreviated (`full` given). */
export function truncatedTooltip(cut: boolean, abbreviated: boolean, focusable: boolean) {
  const active = cut || abbreviated;
  return { active, tabStop: active && focusable };
}

export interface TooltipState {
  open: boolean;
  /** Pointer type of the last press on the trigger (`mouse`, `touch`, `pen`, or "" for keyboard). */
  lastPointer: string;
}

export type TooltipEvent =
  /** Base UI asks to open or close (hover delay, focus, Escape, a press outside). */
  | { type: "primitive"; open: boolean }
  | { type: "pointerdown"; pointerType: string }
  /** A click on the trigger; on touch it toggles, since touch has no hover. */
  | { type: "click" };

export interface TooltipOptions {
  disabled: boolean;
  toggleOnTap: boolean;
}

export const INITIAL_TOOLTIP: TooltipState = { open: false, lastPointer: "" };

export function tooltipReducer(
  state: TooltipState,
  event: TooltipEvent,
  options: TooltipOptions
): TooltipState {
  switch (event.type) {
    case "primitive":
      return { ...state, open: event.open && !options.disabled };
    case "pointerdown":
      return { ...state, lastPointer: event.pointerType };
    case "click":
      if (!options.toggleOnTap || options.disabled || state.lastPointer !== "touch") return state;
      return { ...state, open: !state.open };
  }
}
