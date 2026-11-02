import { describe, expect, it } from "vitest";

import { fullDate, plural, shortDate, shortDateTime } from "./format";

describe("format", () => {
  it("formats UTC dates the way the bulletin and emails do", () => {
    const d = new Date("2026-10-20T03:41:09Z");
    expect(shortDate(d)).toBe("Tue 20 Oct");
    expect(shortDateTime(d)).toBe("Tue 20 Oct 03:41 UTC");
    expect(fullDate(d)).toBe("20 Oct 2026");
  });

  it("pluralises counts", () => {
    expect(plural(1, "repo")).toBe("1 repo");
    expect(plural(3, "repo")).toBe("3 repos");
    expect(plural(2, "advisory", "advisories")).toBe("2 advisories");
  });
});
