import { describe, expect, it } from "vitest";

import { embeddedEmailCss, embeddedEmailHtml } from "./embed";
import { emailShell } from "./layout";

describe("embedded email", () => {
  const html = emailShell({ language: "en", title: "T", body: "<p>Hello</p>", footer: "F" });

  it("keeps the body and its look, drops the document around it", () => {
    const div = embeddedEmailHtml(html);
    expect(div).toMatch(/^<div class="b-page" style="margin:0;padding:0;background:#f2f5f7;/);
    expect(div).toContain("<p>Hello</p>");
    expect(div).not.toMatch(/<(html|head|body|style|title)\b/);
  });

  it("scopes every rule, and applies the dark palette only where the page says", () => {
    const css = embeddedEmailCss(".mail-body", [
      { prefix: '[data-theme="dark"] ' },
      { media: "(prefers-color-scheme: dark)", prefix: ':root:not([data-theme="light"]) ' },
    ]);
    expect(css).toContain("  .mail-body .m-page{");
    expect(css).toContain('[data-theme="dark"] .mail-body .b-card{background:#111a20 !important');
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\)\{\n:root:not\(\[data-theme="light"\]\) \.mail-body \.b-page\{/
    );
    // Nothing global: no :root colour-scheme, no Outlook attribute selectors.
    expect(css).not.toContain("color-scheme:light dark");
    expect(css).not.toContain("data-ogs");
    for (const rule of css.split("\n").filter((l) => l.includes("{") && !l.startsWith("@"))) {
      expect(rule).toContain(".mail-body ");
    }
  });
});
