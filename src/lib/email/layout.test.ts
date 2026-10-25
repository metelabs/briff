import { describe, expect, it } from "vitest";

import { renderTestEmail, renderUrgentEmail } from "./alert-email";
import { darkCss, emailShell, fixBox, mobileCss, tag } from "./layout";

describe("email shell", () => {
  it("shows one logo tile from the app origin that reads in light and dark", () => {
    const html = emailShell({
      language: "en",
      title: "t",
      body: "",
      footer: "f",
      assetBaseUrl: "https://app.briff.dev/",
    });
    expect(html).toContain('src="https://app.briff.dev/brand/lockup-email-tile.png"');
    expect(html).toContain('width="88" height="40"');
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain('<meta name="supported-color-schemes" content="light dark">');
  });

  it("repeats the dark palette for Outlook.com's data-ogsc / data-ogsb", () => {
    const css = darkCss();
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain(".b-card{background:#111a20 !important;border-color:#21303a !important}");
    expect(css).toContain(
      "[data-ogsb] .b-card{background:#111a20 !important;border-color:#21303a !important}"
    );
    expect(css).toContain("[data-ogsc] .b-text{color:#e5edf1 !important}");
    expect(css).toContain("[data-ogsb] .t-sec{background:#3a1912 !important}");
    expect(css).toContain("[data-ogsc] .t-sec{color:#ff7b64 !important}");
    // Text-only rules have no background mirror, and the reverse.
    expect(css).not.toContain("[data-ogsb] .b-text");
    expect(css).not.toContain("[data-ogsc] .b-page");
  });

  it("gives every table and cell a bgcolor attribute and avoids pure white or black", () => {
    const html = renderUrgentEmail(
      "en",
      [
        {
          title: "Node.js security release",
          url: "https://nodejs.org/en/blog",
          bucket: "security",
          reason: "runtime-security",
          sourceName: "Node.js blog",
          affectedRepos: ["briff"],
          runtime: {
            name: "Node.js",
            severity: "HIGH",
            cveIds: ["CVE-2026-1"],
            fixedVersions: ["22.23.4"],
            scheduledFor: null,
            repos: [{ repo: "briff", runs: ["node 22 (Dockerfile)"] }],
            action: "briff: rebuild to pick up Node.js 22.23.4",
          },
        },
      ],
      "https://x.test"
    ).html;
    for (const tagHtml of html.match(/<(table|td)\b[^>]*>/g) ?? []) {
      expect(tagHtml).toContain("bgcolor=");
    }
    expect(html).toContain('<body class="b-page" bgcolor="#f2f5f7"');
    expect(html.toLowerCase()).not.toMatch(/#fff\b|#ffffff|#000\b|#000000/);
  });

  it("gives phones the width back in a style block of its own, without touching dark mode", () => {
    const css = mobileCss();
    expect(css).toContain("@media only screen and (max-width: 480px)");
    expect(css).toContain(".m-frame{padding:18px 12px !important}");
    expect(css).toContain(".m-inset{padding:8px !important}");
    expect(css).toMatch(/\.m-cmd\{[^}]*white-space:pre !important;overflow-x:auto !important/);
    // Class selectors only: an attribute selector could make Gmail drop the block.
    expect(css).not.toContain("[");
    const html = emailShell({ language: "en", title: "t", body: "", footer: "f" });
    const blocks = html.match(/<style>[\s\S]*?<\/style>/g) ?? [];
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain("max-width: 480px");
    expect(blocks[0]).not.toContain("prefers-color-scheme");
    expect(blocks[1]).toContain("[data-ogsb] .b-card");
    expect(html).toContain('class="b-page m-page"');
    expect(html).toContain('class="b-card b-text m-frame"');
  });

  it("lets a fix command scroll on phones inside fixed-layout tables", () => {
    const html = fixBox("To do", "npm i nodemailer@10.1.3", true);
    expect(html).toContain('class="b-inset m-fixed"');
    expect(html).toContain('class="b-inset b-text m-inset"');
    expect(html).toContain('class="b-card b-text m-cmd"');
  });

  it("typesets the word when no origin is known (replay harness)", () => {
    const html = emailShell({ language: "en", title: "t", body: "", footer: "f" });
    expect(html).not.toContain("<img");
    expect(html).toContain(">briff</span>");
  });

  it("passes the origin through every template", () => {
    expect(renderTestEmail("en", "https://x.test").html).toContain("https://x.test/brand/");
    expect(renderUrgentEmail("en", [], "https://x.test").html).toContain("https://x.test/brand/");
  });

  it("upper-cases labels with caps(), never CSS", () => {
    expect(tag("Security", "sec")).toContain(">SECURITY<");
    expect(tag("Security", "sec")).not.toContain("text-transform");
  });
});
