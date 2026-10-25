import { describe, it, expect } from "vitest";
import { hnItemSchema } from "./hackernews";
import { githubRepoSchema } from "./github";
import { phNodeSchema } from "./producthunt";

describe("platform zod schemas — valid fixtures parse, defaults apply", () => {
  it("hackernews item", () => {
    const parsed = hnItemSchema.parse({ id: 1, title: "t", time: 1_700_000_000, type: "story" });
    expect(parsed.score).toBe(0); // default
    expect(parsed.by).toBe("unknown"); // default
  });

  it("github repo", () => {
    const parsed = githubRepoSchema.parse({
      id: 1,
      full_name: "a/b",
      html_url: "https://github.com/a/b",
      created_at: "2026-06-01",
      owner: { login: "a" },
    });
    expect(parsed.language).toBeNull();
    expect(parsed.topics).toEqual([]);
  });

  it("product hunt node", () => {
    expect(phNodeSchema.safeParse({ id: "1", name: "n", url: "u", createdAt: "t" }).success).toBe(
      true
    );
  });
});

describe("platform zod schemas — malformed payloads are rejected", () => {
  it("hackernews: missing required id", () => {
    expect(hnItemSchema.safeParse({ title: "t", time: 1, type: "story" }).success).toBe(false);
  });
  it("github: missing full_name", () => {
    expect(
      githubRepoSchema.safeParse({ id: 1, html_url: "u", created_at: "t", owner: { login: "a" } })
        .success
    ).toBe(false);
  });
});
