import { describe, expect, it } from "vitest";

import { githubAnchor, parseChangelogMarkdown } from "./changelog-md";

const MD = `# Changelog

## 2.1.300

- Added a thing
- Fixed another

## 2.1.299

- Older change

## [2.1.298]
`;

describe("parseChangelogMarkdown", () => {
  it("splits on version headings and drops empty entries", () => {
    const entries = parseChangelogMarkdown(MD);
    expect(entries.map((e) => e.version)).toEqual(["2.1.300", "2.1.299"]);
    expect(entries[0].body).toBe("- Added a thing\n- Fixed another");
    expect(entries[0].anchor).toBe("21300");
  });

  it("respects the limit", () => {
    expect(parseChangelogMarkdown(MD, 1)).toHaveLength(1);
  });

  it("builds GitHub-style anchors", () => {
    expect(githubAnchor("1.0.0 (2026-01-01)")).toBe("100-2026-01-01");
  });
});
