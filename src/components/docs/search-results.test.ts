import { describe, expect, it } from "vitest";

import { groupResults, snippet, type SearchDoc } from "./search-results";

const doc = (page: string, heading: string): SearchDoc => ({
  href: `/docs/${page}#${heading}`,
  page,
  section: "Self-hosting",
  heading,
  text: "",
});

describe("docs search results", () => {
  it("groups hits by page in the order of each page's best hit", () => {
    const groups = groupResults([doc("Install", "a"), doc("Updating", "b"), doc("Install", "c")]);
    expect(groups.map((g) => [g.page, g.hits.map((h) => h.heading)])).toEqual([
      ["Install", ["a", "c"]],
      ["Updating", ["b"]],
    ]);
  });

  it("caps the hits per page", () => {
    const hits = ["a", "b", "c", "d", "e"].map((h) => doc("Install", h));
    expect(groupResults(hits, 4)[0].hits).toHaveLength(4);
  });

  it("cuts the text around the first query word", () => {
    const text = `${"x ".repeat(100)}backup and restore ${"y ".repeat(100)}`;
    const out = snippet(text, "restore");
    expect(out).toContain("restore");
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
    expect(snippet("short text", "nothing")).toBe("short text");
  });
});
