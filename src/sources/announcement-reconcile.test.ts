import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { runtimeMetaFromText } from "@/lib/runtime-security";

import { isAnnouncementSource, updatedAnnouncementMeta } from "./announcement-reconcile";
import { markdownToText } from "./post-body";

const text = (variant: "pre" | "post") =>
  markdownToText(
    readFileSync(
      new URL(
        `./__fixtures__/nodejs-october-2026-security-releases.${variant}.md`,
        import.meta.url
      ),
      "utf-8"
    )
  );
const TITLE = "Wednesday, October 21, 2026 Security Releases";
const now = new Date("2026-10-21T22:05:00Z");

describe("updatedAnnouncementMeta", () => {
  it("stamps fixAddedAt when the release-day edit brings the first fixed versions", () => {
    const pre = runtimeMetaFromText(TITLE, text("pre"));
    const { meta, fixAdded } = updatedAnnouncementMeta(pre, TITLE, text("post"), now);
    expect(fixAdded).toBe(true);
    expect(meta.fixedVersions).toEqual(["22.23.4", "24.22.1", "26.12.1"]);
    expect(meta.fixAddedAt).toBe("2026-10-21T22:05:00.000Z");
    expect(meta.scheduledAt).toBeUndefined();
  });

  it("keeps the first stamp on later edits (credits) and never stamps without fixes", () => {
    const post = {
      ...runtimeMetaFromText(TITLE, text("post")),
      fixAddedAt: "2026-10-21T22:05:00.000Z",
    };
    const again = updatedAnnouncementMeta(post, TITLE, `${text("post")}\nThanks.`, new Date());
    expect(again.fixAdded).toBe(false);
    expect(again.meta.fixAddedAt).toBe("2026-10-21T22:05:00.000Z");

    const pre = runtimeMetaFromText(TITLE, text("pre"));
    const reworded = updatedAnnouncementMeta(pre, TITLE, `${text("pre")}\nUpdated.`, now);
    expect(reworded.fixAdded).toBe(false);
    expect(reworded.meta.fixAddedAt).toBeUndefined();
  });

  it("only applies to feed sources of the security class with a runtime", () => {
    const base = { id: "s", kind: "rss", class: "security", runtime: "node" };
    expect(isAnnouncementSource(base)).toBe(true);
    expect(isAnnouncementSource({ ...base, kind: "github_advisories" })).toBe(false);
    expect(isAnnouncementSource({ ...base, class: "releases" })).toBe(false);
    expect(isAnnouncementSource({ ...base, runtime: null })).toBe(false);
  });
});
