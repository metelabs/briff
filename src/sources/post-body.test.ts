import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseRss } from "@/lib/rss/parser";
import { runtimeMetaFromText } from "@/lib/runtime-security";

import { markdownToText, postBodyUrl } from "./post-body";

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf-8");
const TITLE = "Wednesday, October 21, 2026 Security Releases";

describe("Node.js vulnerability posts", () => {
  it("has no body in the feed, so the item link maps to the post's Markdown", () => {
    const feed = parseRss(fixture("nodejs-vulnerability.xml"));
    expect(feed.items[0].title).toBe(TITLE);
    expect(feed.items[0].content ?? "").toBe("");
    expect(postBodyUrl(feed.items[0].link)).toBe(
      "https://raw.githubusercontent.com/nodejs/nodejs.org/main/apps/site/pages/en/blog/vulnerability/october-2026-security-releases.md"
    );
    expect(postBodyUrl("https://www.php.net/archive/2026.php#1")).toBeNull();
    expect(postBodyUrl("https://nodejs.org/en/blog/vulnerability/../../x")).toBeNull();
  });

  it("turns Markdown into plain text without front matter or link targets", () => {
    const text = markdownToText(fixture("nodejs-october-2026-security-releases.post.md"));
    expect(text.startsWith("Security releases available")).toBe(true);
    expect(text).not.toContain("date: 2026-10-21");
    expect(text).toContain("- Node.js v22.23.4\n- Node.js v24.22.1\n- Node.js v26.12.1");
    expect(text).toContain("This vulnerability affects Node.js 26.x, 24.x, and 22.x.");
    expect(text).not.toContain("](");
  });

  it("reads the pre-announcement as scheduled, with its affected lines and severity", () => {
    const meta = runtimeMetaFromText(
      TITLE,
      markdownToText(fixture("nodejs-october-2026-security-releases.pre.md"))
    );
    expect(meta).toEqual({
      kind: "announcement",
      cveIds: [],
      severity: "high",
      fixedVersions: [],
      scheduledAt: "2026-10-21",
      affectedLines: ["26", "24", "22"],
    });
  });

  it("reads the release-day post: fixed versions per line, CVEs, same affected lines", () => {
    const meta = runtimeMetaFromText(
      TITLE,
      markdownToText(fixture("nodejs-october-2026-security-releases.post.md"))
    );
    expect(meta.fixedVersions).toEqual(["22.23.4", "24.22.1", "26.12.1"]);
    expect(meta.scheduledAt).toBeUndefined();
    expect(meta.severity).toBe("high");
    expect(meta.affectedLines).toEqual(["26", "24", "22"]);
    expect(meta.cveIds).toContain("CVE-2026-111497");
    expect(meta.cveIds).toHaveLength(10);
  });
});
