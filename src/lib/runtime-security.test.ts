import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseRss } from "@/lib/rss/parser";
import { htmlToText } from "@/lib/text";

import {
  compareDotted,
  emailsImmediately,
  fixedVersionsFromText,
  isRuntimeSecurityText,
  mergeFixedVersions,
  parseRuntimeMeta,
  releaseLineOf,
  repoFixStatus,
  runtimeMetaFromText,
  scheduledRelease,
} from "./runtime-security";

// php.net news feed as served on 22 Oct 2026 (PHP2Shell, CVE-2026-109618/109619).
const feed = parseRss(
  readFileSync(new URL("../sources/__fixtures__/php-news.atom", import.meta.url), "utf8")
);
const entry = (title: string) => {
  const e = feed.items.find((i) => i.title === title);
  if (!e) throw new Error(`missing ${title}`);
  return { title: e.title, body: htmlToText(e.content) };
};

describe("isRuntimeSecurityText", () => {
  it("matches the PHP2Shell posts and leaves ordinary posts alone", () => {
    for (const title of [
      "Upcoming Critical PHP Security Release",
      "Security advisory: Critical remote code execution vulnerabilities, update now",
      "PHP 8.3.36 Released!",
    ]) {
      const e = entry(title);
      expect(isRuntimeSecurityText(e.title, e.body)).toBe(true);
    }
    const rc = entry("PHP 8.6.0 RC3 available for testing");
    expect(isRuntimeSecurityText(rc.title, rc.body)).toBe(false);
  });

  it("matches CVE ids and out-of-cycle releases, not a passing mention of security", () => {
    expect(isRuntimeSecurityText("Wednesday, October 21, 2026 Security Releases", "")).toBe(true);
    expect(isRuntimeSecurityText("[Security-announce][CVE-2026-19445] Use-after-free", "")).toBe(
      true
    );
    expect(isRuntimeSecurityText("Ruby 4.0.8 Released", "Fixes CVE-2026-1234 in net-imap.")).toBe(
      true
    );
    expect(isRuntimeSecurityText("Go 1.27.3", "An out-of-cycle release is planned.")).toBe(true);
    expect(
      isRuntimeSecurityText("Deno 2.9", "We improved the security model of permissions.")
    ).toBe(false);
  });
});

describe("runtimeMetaFromText", () => {
  it("reads the pre-announcement: no fixed versions, scheduled for 21 Oct 14:00 UTC", () => {
    const e = entry("Upcoming Critical PHP Security Release");
    expect(runtimeMetaFromText(e.title, e.body)).toEqual({
      kind: "announcement",
      cveIds: [],
      severity: "critical",
      fixedVersions: [],
      scheduledAt: "2026-10-21T14:00:00.000Z",
    });
  });

  it("reads the advisory post: CVEs and the fixed version of every line", () => {
    const e = entry(
      "Security advisory: Critical remote code execution vulnerabilities, update now"
    );
    const meta = runtimeMetaFromText(e.title, e.body);
    expect(meta.cveIds).toEqual(["CVE-2026-109618", "CVE-2026-109619"]);
    expect(meta.fixedVersions).toEqual(["8.5.12", "8.4.27", "8.3.36", "8.2.35"]);
    expect(meta.lineSpecific).toBeUndefined();
    expect(meta.scheduledAt).toBeUndefined();
  });

  it("files a single release post as line-specific", () => {
    const e = entry("PHP 8.3.36 Released!");
    const meta = runtimeMetaFromText(e.title, e.body);
    expect(meta.fixedVersions).toEqual(["8.3.36"]);
    expect(meta.lineSpecific).toBe(true);
  });
});

describe("fixedVersionsFromText", () => {
  it("takes every version of a multi-release title (nginx)", () => {
    expect(
      fixedVersionsFromText(
        "nginx-1.30.6 stable and nginx-1.31.7 mainline versions have been released, with fixes for buffer overflow vulnerability (CVE-2026-15176)",
        ""
      )
    ).toEqual({ versions: ["1.30.6", "1.31.7"], lineSpecific: false });
  });

  it("ignores scores and dates outside fix sentences", () => {
    expect(fixedVersionsFromText("Upcoming release", "Rated CVSS v4.0 9.2.")).toEqual({
      versions: [],
      lineSpecific: false,
    });
  });
});

describe("scheduledRelease", () => {
  it("parses day-first and month-first dates in the body", () => {
    expect(
      scheduledRelease("", "It is scheduled for Wednesday, 21 October 2026 at 14:00 UTC.")
    ).toEqual({ at: new Date("2026-10-21T14:00:00Z"), hasTime: true });
    expect(scheduledRelease("", "Releases are scheduled for October 21, 2026.")).toEqual({
      at: new Date("2026-10-21T00:00:00Z"),
      hasTime: false,
    });
    expect(scheduledRelease("", "No date yet.")).toBeNull();
  });

  it("reads the release day from a Node.js security release title", () => {
    expect(runtimeMetaFromText("Wednesday, October 21, 2026 Security Releases", "")).toMatchObject({
      fixedVersions: [],
      scheduledAt: "2026-10-21",
    });
  });
});

describe("versionsIn", () => {
  it("leaves calendar versions out", () => {
    expect(
      fixedVersionsFromText("CRITICAL security update for certifi", "Upgrade to 2026.10.19 now.")
    ).toEqual({ versions: [], lineSpecific: false });
  });
});

describe("repoFixStatus", () => {
  const meta = { fixedVersions: ["8.5.12", "8.4.27", "8.3.36", "8.2.35"] };

  it("names the fix on the repo's release line", () => {
    expect(repoFixStatus("php", meta, "8.3")).toEqual({
      kind: "fix",
      line: "8.3",
      version: "8.3.36",
    });
    expect(repoFixStatus("php", meta, "8.3.20")).toEqual({
      kind: "fix",
      line: "8.3",
      version: "8.3.36",
    });
  });

  it("treats an exact version at or past the fix as unaffected", () => {
    expect(repoFixStatus("php", meta, "8.3.36")).toEqual({ kind: "unaffected" });
  });

  it("flags an older, still supported line as unsupported with the nearest fix on its major", () => {
    // php 8.1 reached end of life on 31 Dec 2025.
    const before = new Date("2025-06-01T00:00:00Z");
    expect(repoFixStatus("php", meta, "8.1", before)).toEqual({
      kind: "unsupported",
      line: "8.1",
      nearest: "8.2.35",
    });
    expect(repoFixStatus("dotnet", { fixedVersions: ["8.0.20"] }, "7.0")).toEqual({
      kind: "unsupported",
      line: "7.0",
      nearest: null,
    });
  });

  it("marks an end-of-life line the post does not list as eol, with the lowest newer fix", () => {
    const asOf = new Date("2026-10-23T00:00:00Z");
    expect(repoFixStatus("php", meta, "8.1", asOf)).toEqual({
      kind: "eol",
      line: "8.1",
      target: "8.2.35",
    });
    expect(repoFixStatus("php", meta, "7.4", asOf)).toEqual({
      kind: "eol",
      line: "7.4",
      target: "8.2.35",
    });
  });

  it("uses the affected lines of a post: other supported lines are unaffected, EOL ones are not", () => {
    const asOf = new Date("2026-10-23T00:00:00Z");
    const pre = { fixedVersions: [], affectedLines: ["26", "24", "22"] };
    expect(repoFixStatus("node", pre, "22", asOf)).toEqual({ kind: "unknown" });
    expect(repoFixStatus("node", pre, "18", asOf)).toEqual({
      kind: "eol",
      line: "18",
      target: "22",
    });
    // Newer than the EOL table: cannot be placed, so it stays possibly affected.
    expect(repoFixStatus("node", pre, "27", asOf)).toEqual({ kind: "unknown" });
    expect(repoFixStatus("node", { ...pre, affectedLines: ["26", "24"] }, "22", asOf)).toEqual({
      kind: "unaffected",
    });
    const post = { ...pre, fixedVersions: ["22.23.4", "24.22.1", "26.12.1"] };
    expect(repoFixStatus("node", post, "20.9.0", asOf)).toEqual({
      kind: "eol",
      line: "20",
      target: "22.23.4",
    });
    expect(repoFixStatus("node", post, "25", asOf)).toEqual({
      kind: "eol",
      line: "25",
      target: "26.12.1",
    });
    // A gap in the EOL table below its newest line is history: node 17 is end of life.
    expect(repoFixStatus("node", post, "17", asOf)).toEqual({
      kind: "eol",
      line: "17",
      target: "22.23.4",
    });
    expect(repoFixStatus("node", post, "27", asOf)).toEqual({ kind: "unknown" });
    expect(repoFixStatus("node", { ...post, affectedLines: ["26", "24"] }, "22", asOf)).toEqual({
      kind: "fix",
      line: "22",
      version: "22.23.4",
    });
    expect(repoFixStatus("node", post, "24.16.0", asOf)).toEqual({
      kind: "fix",
      line: "24",
      version: "24.22.1",
    });
  });

  it("keeps a single-release post to its own line", () => {
    expect(repoFixStatus("php", { fixedVersions: ["8.4.27"], lineSpecific: true }, "8.3")).toEqual({
      kind: "unaffected",
    });
  });

  it("never calls an end-of-life or unknown line unaffected under a single-release post", () => {
    const post = { fixedVersions: ["8.3.36"], lineSpecific: true };
    const asOf = new Date("2026-10-21T14:00:00Z");
    expect(repoFixStatus("php", post, "8.1.31", asOf)).toEqual({
      kind: "eol",
      line: "8.1",
      target: "8.2",
    });
    expect(repoFixStatus("php", post, "8.6", asOf)).toEqual({ kind: "unknown" });
    expect(repoFixStatus("php", post, "8.5.12", asOf)).toEqual({ kind: "unaffected" });
  });

  it("moves an end-of-life line to the lowest supported line, not the line a post names", () => {
    const asOf = new Date("2026-10-21T14:00:00Z");
    const only26 = { fixedVersions: ["26.12.1"], lineSpecific: true };
    expect(repoFixStatus("node", only26, "18", asOf)).toEqual({
      kind: "eol",
      line: "18",
      target: "22",
    });
    const all = { fixedVersions: ["26.12.1", "24.22.1", "22.23.4"] };
    expect(repoFixStatus("node", all, "18", asOf)).toEqual({
      kind: "eol",
      line: "18",
      target: "22.23.4",
    });
  });

  it("is unknown without fixed versions or a usable version", () => {
    expect(repoFixStatus("php", { fixedVersions: [] }, "8.3")).toEqual({ kind: "unknown" });
    expect(repoFixStatus("php", meta, null)).toEqual({ kind: "unknown" });
    expect(repoFixStatus("php", meta, "8")).toEqual({ kind: "unknown" });
  });

  it("uses major lines for Node.js", () => {
    expect(repoFixStatus("node", { fixedVersions: ["24.22.1", "22.21.3"] }, "22")).toEqual({
      kind: "fix",
      line: "22",
      version: "22.21.3",
    });
  });
});

describe("helpers", () => {
  it("compares, groups and merges versions per line", () => {
    expect(compareDotted("8.3.36", "8.3.4")).toBeGreaterThan(0);
    expect(releaseLineOf("postgres", "17.7")).toBe("17");
    expect(mergeFixedVersions("php", [["8.3.35", "8.4.26"], ["8.3.36"]])).toEqual([
      "8.4.26",
      "8.3.36",
    ]);
  });

  it("emails critical, high and unknown severity only", () => {
    const base = { kind: "advisory" as const, cveIds: [], fixedVersions: [] };
    expect(emailsImmediately({ ...base, severity: "critical" })).toBe(true);
    expect(emailsImmediately({ ...base, severity: null })).toBe(true);
    expect(emailsImmediately({ ...base, severity: "medium" })).toBe(false);
  });

  it("parses stored metadata and rejects other shapes", () => {
    expect(parseRuntimeMeta({ kind: "announcement" })).toEqual({
      kind: "announcement",
      cveIds: [],
      severity: null,
      fixedVersions: [],
    });
    expect(parseRuntimeMeta({ foo: 1 })).toBeNull();
    expect(parseRuntimeMeta(null)).toBeNull();
  });
});
