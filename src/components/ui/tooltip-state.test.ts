import { describe, expect, it } from "vitest";

import {
  INITIAL_TOOLTIP,
  isCut,
  tooltipReducer,
  truncatedTooltip,
  type TooltipEvent,
  type TooltipOptions,
} from "./tooltip-state";

const on: TooltipOptions = { disabled: false, toggleOnTap: true };

function run(events: TooltipEvent[], options: TooltipOptions = on) {
  return events.reduce((s, e) => tooltipReducer(s, e, options), INITIAL_TOOLTIP);
}

describe("isCut", () => {
  it("is true only when the text is wider than its box, with 1px of rounding slack", () => {
    expect(isCut({ scrollWidth: 120, clientWidth: 100 })).toBe(true);
    expect(isCut({ scrollWidth: 101, clientWidth: 100 })).toBe(false);
    expect(isCut({ scrollWidth: 100, clientWidth: 100 })).toBe(false);
  });
});

describe("truncatedTooltip", () => {
  it("shows the tooltip for cut or abbreviated text only", () => {
    expect(truncatedTooltip(false, false, true)).toEqual({ active: false, tabStop: false });
    expect(truncatedTooltip(true, false, true)).toEqual({ active: true, tabStop: true });
    expect(truncatedTooltip(false, true, true)).toEqual({ active: true, tabStop: true });
  });

  it("stays out of the tab order when not focusable (menus, links)", () => {
    expect(truncatedTooltip(true, false, false)).toEqual({ active: true, tabStop: false });
  });
});

describe("tooltipReducer", () => {
  it("follows Base UI for hover and focus, and closes on dismiss", () => {
    expect(run([{ type: "primitive", open: true }]).open).toBe(true);
    expect(
      run([
        { type: "primitive", open: true },
        { type: "primitive", open: false },
      ]).open
    ).toBe(false);
  });

  it("toggles on a touch tap, and a press outside closes it", () => {
    const tap: TooltipEvent[] = [{ type: "pointerdown", pointerType: "touch" }, { type: "click" }];
    expect(run(tap).open).toBe(true);
    expect(run([...tap, ...tap]).open).toBe(false);
    expect(run([...tap, { type: "primitive", open: false }]).open).toBe(false);
  });

  it("does not toggle on a mouse click or a keyboard activation", () => {
    expect(run([{ type: "pointerdown", pointerType: "mouse" }, { type: "click" }]).open).toBe(
      false
    );
    expect(run([{ type: "click" }]).open).toBe(false);
    // Hover opened it; a mouse click does not close it.
    expect(
      run([
        { type: "primitive", open: true },
        { type: "pointerdown", pointerType: "mouse" },
        { type: "click" },
      ]).open
    ).toBe(true);
  });

  it("never opens when disabled or when tap toggling is off", () => {
    const disabled = { disabled: true, toggleOnTap: true };
    expect(run([{ type: "primitive", open: true }], disabled).open).toBe(false);
    expect(
      run([{ type: "pointerdown", pointerType: "touch" }, { type: "click" }], disabled).open
    ).toBe(false);
    expect(
      run([{ type: "pointerdown", pointerType: "touch" }, { type: "click" }], {
        disabled: false,
        toggleOnTap: false,
      }).open
    ).toBe(false);
  });
});
