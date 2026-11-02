import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SOURCE_URL } from "./links";
import { PublicFooter, PublicHeader } from "./public-chrome";

describe("public chrome", () => {
  it("links the header's GitHub button to the repository with an accessible name", () => {
    const html = renderToStaticMarkup(createElement(PublicHeader));
    const button = html.match(/<a[^>]*aria-label="Briff on GitHub"[^>]*>.*?<\/a>/)?.[0] ?? "";
    expect(button).toContain(`href="${SOURCE_URL}"`);
    expect(button).toContain('rel="noreferrer"');
    expect(button).toContain('viewBox="0 0 24 24"');
    expect(button).toContain(">GitHub</span>");
  });

  it("shows the GitHub mark and label in the footer instead of a bare Source link", () => {
    const html = renderToStaticMarkup(createElement(PublicFooter));
    const link = html.match(new RegExp(`<a href="${SOURCE_URL}"[^>]*>.*?</a>`))?.[0] ?? "";
    expect(link).toContain('viewBox="0 0 24 24"');
    expect(link).toContain("GitHub");
    expect(html).not.toContain(">Source<");
  });
});
