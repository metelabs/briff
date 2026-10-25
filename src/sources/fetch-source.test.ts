import { describe, expect, it } from "vitest";

import { changelogPageUrl, contentHash } from "./fetch-source";

describe("fetch-source helpers", () => {
  it("maps raw GitHub URLs to their blob page", () => {
    expect(
      changelogPageUrl("https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md")
    ).toBe("https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md");
    expect(changelogPageUrl("https://example.com/CHANGELOG.md")).toBe(
      "https://example.com/CHANGELOG.md"
    );
  });

  it("hashes url + title, ignoring surrounding whitespace", () => {
    expect(contentHash("https://a/1", "Title")).toBe(contentHash(" https://a/1 ", "Title\n"));
    expect(contentHash("https://a/1", "Title")).not.toBe(contentHash("https://a/2", "Title"));
  });
});
