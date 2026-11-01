import { describe, expect, it } from "vitest";

import type { BulletinView, BulletinViewItem } from "@/pipeline/bulletin-view";

import { renderSecurityAlertEmail, renderUrgentEmail } from "./alert-email";
import { bulletinPageUrl, isCommand, kickerLine, renderBulletinEmail } from "./bulletin-email";
import { strings } from "@/lib/i18n";

const item = (over: Partial<BulletinViewItem>): BulletinViewItem => ({
  itemId: "item",
  bucket: "breaking_or_feature",
  headline: "Headline",
  line: "",
  action: "",
  todo: null,
  title: "Title",
  url: "https://example.com",
  sourceName: "Source",
  affectedRepos: [],
  dueAt: null,
  upgrades: [],
  folded: [],
  ...over,
});

const view: BulletinView = {
  id: "b1",
  orgId: "o1",
  weekLabel: "2026-W42",
  streamId: "s1",
  streamName: "Work",
  language: "en",
  subject: "Briff · Work · W42: <Next> & co",
  summary: "Summary <script>alert(1)</script>",
  minorCount: 23,
  model: "claude-sonnet-5-5",
  promptVersion: "synthesis-v2",
  createdAt: new Date("2026-10-15T00:00:00Z"),
  emailStatus: "pending",
  emailSentAt: null,
  preview: false,
  act: [
    item({
      itemId: "item1",
      bucket: "security",
      headline: "Next.js middleware bypass",
      line: "garden uses 15.5.27.",
      action: "npm i next@15.5.28",
      url: "https://nextjs.org/blog/cve",
      affectedRepos: ["garden"],
      folded: [
        { title: "vercel/next.js v15.5.27", url: "https://github.com/x", release: true },
        {
          title: "Upcoming Next.js Security Update for Upstream Vulnerabilities",
          url: "https://nextjs.org/blog/upcoming",
          release: false,
        },
      ],
    }),
  ],
  know: [
    item({
      itemId: "item2",
      headline: "Bad link",
      url: "javascript:alert(1)",
      todo: "wait",
      action: "when SDK 56 is stable",
      dueAt: new Date("2026-08-31T00:00:00Z"),
    }),
  ],
  rest: [item({ itemId: "item3" }), item({ itemId: "item4" })],
  minor: [],
  alerts: [
    {
      packageName: "next",
      severity: "CRITICAL",
      osvIds: ["GHSA-1", "GHSA-2"],
      repos: ["garden"],
      fixed: "15.4.8",
      noLineFix: false,
      transitive: false,
      installs: [],
    },
    {
      packageName: "handlebars",
      severity: "CRITICAL",
      osvIds: ["GHSA-3"],
      repos: ["garden"],
      fixed: "4.7.10",
      noLineFix: false,
      transitive: false,
      installs: [],
    },
  ],
  backlogAlerts: [],
};

const links = { baseUrl: "https://app.briff.dev/", token: "tok.123.sig" };

describe("renderBulletinEmail", () => {
  const email = renderBulletinEmail(view, links);

  it("keeps the font stack from breaking the style attribute", () => {
    expect(email.html).not.toMatch(/style="[^"]*"Segoe/);
    expect(email.html).not.toMatch(/style="[^"]*"SFMono/);
  });

  it("escapes every dynamic string and refuses non-http links", () => {
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).not.toContain("javascript:");
    expect(email.subject).toBe(view.subject);
  });

  it("links each item to its anchor on the signed page and has no feedback buttons", () => {
    const details = bulletinPageUrl(links, "b1", "item1");
    expect(details).toBe("https://app.briff.dev/b/b1?t=tok.123.sig#item-item1");
    expect(email.html).toContain(`href="${details}"`);
    expect(email.html).not.toContain("fb=");
    expect(email.text).not.toContain("fb=");
    expect(email.html).not.toContain("Useful");
  });

  it("shows the act action and the know what-to-do, and only counts the rest", () => {
    expect(email.html).toContain("Needs your attention");
    expect(email.html).toContain("npm i next@15.5.28");
    expect(email.html).toContain("GOOD TO KNOW");
    expect(email.html).toContain("WAIT");
    expect(email.html).not.toContain("item3");
    expect(email.text).toContain("Also 25 more items (23 of them minor release notes).");
    // Two package lines stand for three advisories.
    expect(email.text).toContain("3 new security advisories this week.");
    expect(email.text).not.toContain("first scan");
  });

  it("carries the stream name and never relies on CSS upper-casing", () => {
    expect(email.text.split("\n")[0]).toBe("Briff · Work · Week 2026-W42");
    expect(email.html).toContain('<html lang="en">');
    expect(email.html).not.toContain("text-transform");
    expect(email.html).toContain("SECURITY");
    expect(email.html).not.toContain("İ");
  });

  it("renders a bulletin from before streams without a stream name", () => {
    const old = { ...view, streamId: null, streamName: null };
    expect(kickerLine(old, strings("en"))).toBe("Briff · Week 2026-W42");
    expect(renderBulletinEmail(old, links).text).toContain("Briff · Week 2026-W42");
  });

  it("has a plain-text alternative with sections, repos, actions and folded versions", () => {
    expect(email.text).toContain("NEEDS YOUR ATTENTION");
    expect(email.text).toContain("[Security] Next.js middleware bypass");
    expect(email.text).toContain("Affected repos: garden");
    expect(email.text).toContain("  > npm i next@15.5.28");
    expect(email.text).toContain(
      "Also released: vercel/next.js v15.5.27 · Related: Upcoming Next.js Security Update for Upstream Vulnerabilities"
    );
    expect(email.text).toContain("[Wait] Bad link");
    expect(email.text).toContain("Due 2026-08-31");
  });

  it("tells commands from sentence actions", () => {
    expect(isCommand("npm i next@15.5.28")).toBe(true);
    expect(isCommand("npx expo install --fix")).toBe(true);
    expect(isCommand("Raise targetSdkVersion to 36")).toBe(false);
  });

  it("says so when there is nothing to do", () => {
    const empty = renderBulletinEmail(
      { ...view, act: [], know: [], rest: [], minorCount: 0 },
      links
    );
    expect(empty.text).toContain("Nothing needs your attention this week.");
  });
});

describe("dark-mode safety", () => {
  it("gives every table and cell of the bulletin a bgcolor and uses no pure white or black", () => {
    const { html } = renderBulletinEmail(view, { baseUrl: "https://app.briff.dev", token: "t" });
    for (const tagHtml of html.match(/<(table|td)\b[^>]*>/g) ?? []) {
      expect(tagHtml).toContain("bgcolor=");
    }
    expect(html.toLowerCase()).not.toMatch(/#fff\b|#ffffff|#000\b|#000000/);
  });
});

describe("phone layout", () => {
  it("flattens act cards into sections that keep the security rule", () => {
    const { html } = renderBulletinEmail(view, links);
    const card = html.match(/<table[^>]*class="b-card m-flat[^"]*"[^>]*>/)?.[0] ?? "";
    expect(card).toContain('class="b-card m-flat m-fixed b-sec-top"');
    expect(card).toContain("border-top:3px solid #b93522;");
    expect(html).toContain('class="b-card b-text m-flat-cell"');
    // The command sits in fixed-layout tables all the way up, so it scrolls instead of widening the page.
    expect(html).toContain('class="b-card b-text m-cmd"');
    expect(html.match(/class="b-page m-fixed"/g)).toHaveLength(2);
  });
});

describe("bulletin backlog line", () => {
  const backlogLine = {
    packageName: "undici",
    severity: "HIGH",
    osvIds: ["GHSA-a", "GHSA-b"],
    repos: ["briff"],
    fixed: null,
    noLineFix: false,
    transitive: true,
    installs: [],
  };

  it("counts new advisories and adds one calm line for the first-scan backlog", () => {
    const email = renderBulletinEmail({ ...view, backlogAlerts: [backlogLine] }, links);
    expect(email.text).toContain(
      "3 new security advisories this week. 2 older advisories from the first scan are listed on the bulletin page."
    );
  });

  it("says nothing about new advisories when there is only backlog", () => {
    const email = renderBulletinEmail({ ...view, alerts: [], backlogAlerts: [backlogLine] }, links);
    expect(email.text).not.toContain("new security advis");
    expect(email.text).toContain("2 older advisories from the first scan");
  });
});

describe("alert emails", () => {
  it("sends a first scan as one calm summary, without listing advisories", () => {
    const email = renderSecurityAlertEmail("en", [], {
      repos: ["briff", "mint-app"],
      advisories: 252,
      severe: 12,
      url: "https://app.briff.dev/bulletins",
    });
    expect(email.subject).toBe("Briff · first scan: 252 known advisories");
    expect(email.text).toContain(
      "The first scan of 2 repos found 252 known advisories (12 critical or high)."
    );
    expect(email.text).toContain("Open in Briff: https://app.briff.dev/bulletins");
    expect(email.text).not.toContain("osv.dev");
  });

  it("adds the first-scan summary below new alerts", () => {
    const email = renderSecurityAlertEmail(
      "en",
      [
        {
          osvId: "GHSA-x",
          packageName: "next",
          summary: null,
          severity: "HIGH",
          affected: [],
          fallbackFixed: "15.4.8",
          repos: [{ name: "garden", installedVersion: "15.4.7", direct: true }],
        },
      ],
      { repos: ["briff"], advisories: 1, severe: 0, url: "https://app.briff.dev/bulletins" }
    );
    expect(email.subject).toBe("Briff · security: next");
    const text = email.text;
    expect(text.indexOf("* next · HIGH")).toBeLessThan(text.indexOf("The first scan of 1 repo"));
  });

  it("names the package in the subject and lists repos and the fix", () => {
    const email = renderSecurityAlertEmail("en", [
      {
        osvId: "GHSA-x",
        packageName: "next",
        summary: "RCE <in> middleware",
        severity: "CRITICAL",
        affected: [],
        fallbackFixed: "15.4.8",
        repos: [{ name: "garden", installedVersion: "15.4.7", direct: true }],
      },
      {
        osvId: "GHSA-y",
        packageName: "minimist",
        summary: null,
        severity: "LOW",
        affected: [],
        fallbackFixed: null,
        repos: [{ name: "garden", installedVersion: "1.2.0", direct: false }],
      },
    ]);
    expect(email.subject).toBe("Briff · security: next +1");
    expect(email.html).toContain("RCE &lt;in&gt; middleware");
    expect(email.text).toContain("garden (15.4.7)");
    expect(email.text).toContain("Fixed in: 15.4.8");
    // The transitive-only advisory sits in its own group below, labelled, without a fix.
    const lines = email.text.split("\n");
    const transitiveAt = lines.indexOf("TRANSITIVE DEPENDENCIES");
    expect(transitiveAt).toBeGreaterThan(lines.indexOf("* next · CRITICAL"));
    expect(lines[transitiveAt + 3]).toBe("* minimist · transitive · LOW");
    expect(lines[transitiveAt + 4]).toBe("  Repos: garden (1.2.0)");
    expect(email.text).not.toContain("no fix yet");
  });

  it("follows the 'more advisories' heading with the list it announces", () => {
    const groups = Array.from({ length: 27 }, (_, i) => ({
      osvId: `GHSA-${i}`,
      packageName: `pkg-${String(i).padStart(2, "0")}`,
      summary: null,
      severity: "LOW",
      affected: [],
      fallbackFixed: "1.0.1",
      repos: [{ name: "garden", installedVersion: "1.0.0", direct: true }],
    }));
    const lines = renderSecurityAlertEmail("en", groups).text.split("\n");
    const at = lines.indexOf("2 more advisories:");
    expect(at).toBeGreaterThan(0);
    expect(lines[at + 1]).toMatch(/^- pkg-\d\d · LOW · garden · 1\.0\.1 · https:\/\/osv\.dev\//);
    expect(lines[at + 2]).toMatch(/^- pkg-/);
  });

  it("renders urgent items in English", () => {
    const email = renderUrgentEmail("en", [
      {
        title: "Next.js middleware bypass fixed in 16.4.2",
        url: "https://nextjs.org/blog/cve",
        bucket: "security",
        reason: "r",
        sourceName: "Next.js blog",
        affectedRepos: [],
      },
    ]);
    expect(email.subject).toBe("Briff · urgent: Next.js middleware bypass fixed in 16.4.2");
    expect(email.text).toContain("[Security] Next.js middleware bypass fixed in 16.4.2");
  });

  it("writes the urgent SECURITY label in ASCII capitals (no Turkish dotted İ)", () => {
    const email = renderUrgentEmail("en", [
      {
        title: "undici: request smuggling fixed in 7.16.1",
        url: "https://github.com/nodejs/undici/security",
        bucket: "security",
        reason: "r",
        sourceName: "undici releases",
        affectedRepos: ["briff"],
      },
    ]);
    expect(email.html).toContain(">SECURITY<");
    expect(email.html).toContain('<html lang="en">');
    expect(email.html).not.toContain("text-transform");
    expect(email.html).not.toContain("İ");
    expect(email.text).not.toContain("İ");
  });
});
