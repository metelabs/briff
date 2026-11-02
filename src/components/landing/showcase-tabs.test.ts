import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ShowcaseTabs, tabAfterKey, type ShowcaseTab } from "./showcase-tabs";

const TABS: ShowcaseTab[] = ["bulletin", "email", "stack", "alerts"].map((id) => ({
  id,
  label: id,
  caption: `caption ${id}`,
  panel: createElement("p", null, `panel ${id}`),
}));

describe("tabAfterKey", () => {
  it("moves with the arrows and wraps at both ends", () => {
    expect(tabAfterKey("ArrowRight", 1, 4)).toBe(2);
    expect(tabAfterKey("ArrowRight", 3, 4)).toBe(0);
    expect(tabAfterKey("ArrowLeft", 2, 4)).toBe(1);
    expect(tabAfterKey("ArrowLeft", 0, 4)).toBe(3);
  });

  it("jumps to the first and last tab with Home and End", () => {
    expect(tabAfterKey("Home", 2, 4)).toBe(0);
    expect(tabAfterKey("End", 1, 4)).toBe(3);
  });

  it("ignores other keys so Tab and Enter keep their default", () => {
    expect(tabAfterKey("Tab", 1, 4)).toBeNull();
    expect(tabAfterKey("Enter", 1, 4)).toBeNull();
  });
});

describe("ShowcaseTabs", () => {
  const html = renderToStaticMarkup(createElement(ShowcaseTabs, { tabs: TABS }));
  const panels = [...html.matchAll(/<div id="([^"]+)" role="tabpanel" aria-labelledby="([^"]+)"( hidden="")?/g)];

  it("selects the first tab and keeps only it in the tab order", () => {
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-selected="true"[^>]*tabindex="0"[^>]*>bulletin</);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(3);
    expect(html).toContain("caption bulletin");
  });

  it("renders every panel, hiding all but the first, each tied to its tab", () => {
    expect(panels.map((m) => Boolean(m[3]))).toEqual([false, true, true, true]);
    for (const [, panelId, tabId] of panels) {
      expect(html).toContain(`id="${tabId}"`);
      expect(html).toContain(`aria-controls="${panelId}"`);
    }
    for (const t of TABS) expect(html).toContain(`panel ${t.id}`);
  });
});
