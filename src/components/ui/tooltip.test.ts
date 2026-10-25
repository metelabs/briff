import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Tooltip, TruncatedText } from "./tooltip";

/** Server markup of a component; `children` goes in the typed props object. */
function markup<P extends object>(component: FunctionComponent<P>, props: P): string {
  return renderToStaticMarkup(createElement(component, props));
}

// Server render: no layout, so `cut` is false and only the abbreviation path is active.
describe("TruncatedText", () => {
  it("adds no tab stop or description to text that is neither cut nor abbreviated", () => {
    const html = markup(TruncatedText, { children: "briff" });
    expect(html).toContain(">briff</span>");
    expect(html).not.toContain("tabindex");
    expect(html).not.toContain("aria-describedby");
  });

  it("makes an abbreviation focusable and describes it with the full text", () => {
    const html = markup(TruncatedText, { full: "briff, grove, mint-app", children: "3 repos" });
    expect(html).toContain('tabindex="0"');
    const id = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeDefined();
    expect(html).toContain(`id="${id}" hidden="">briff, grove, mint-app</span>`);
  });

  it("keeps an abbreviation out of the tab order when not focusable", () => {
    const html = markup(TruncatedText, { full: "a, b, c", focusable: false, children: "3 repos" });
    expect(html).not.toContain("tabindex");
  });
});

describe("Tooltip", () => {
  it("renders the trigger itself and no popup until opened", () => {
    const html = markup(Tooltip, {
      content: "minor behind 2.117.3",
      children: createElement("span", null, "2.110.7"),
    });
    expect(html).toContain("2.110.7");
    // The content is only the hidden description; the popup is not rendered while closed.
    expect(html.match(/minor behind/g)).toHaveLength(1);
    expect(html).toMatch(/hidden="">minor behind 2\.117\.3<\/span>/);
    const plain = markup(Tooltip, {
      content: "minor behind 2.117.3",
      describe: false,
      children: createElement("span", null, "2.110.7"),
    });
    expect(plain).not.toContain("minor behind");
  });

  it("leaves a disabled trigger without a description", () => {
    const html = markup(Tooltip, {
      content: "x",
      disabled: true,
      children: createElement("span", null, "y"),
    });
    expect(html).not.toContain("aria-describedby");
  });
});
