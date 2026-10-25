import { describe, expect, it } from "vitest";

import { activeSectionId, atPageBottom, scrollTargetTop } from "./scroll";

describe("scrollTargetTop", () => {
  it("puts the element below the sticky bars with a gap", () => {
    // Mobile: the two-row bar is 104px tall.
    expect(scrollTargetTop(900, 104, 5000)).toBe(900 - 104 - 12);
    expect(scrollTargetTop(900, 64, 5000)).toBe(900 - 64 - 12);
  });

  it("stays within the scrollable range", () => {
    expect(scrollTargetTop(40, 64, 5000)).toBe(0);
    expect(scrollTargetTop(4900, 64, 3000)).toBe(3000);
  });
});

describe("activeSectionId", () => {
  const sections = [
    { id: "profile", top: -600 },
    { id: "weights", top: -200 },
    { id: "delivery", top: 60 },
    { id: "scan-tokens", top: 420 },
    { id: "account", top: 760 },
  ];

  it("picks the last section whose top passed the line", () => {
    expect(activeSectionId(sections, 100, false)).toBe("delivery");
    expect(activeSectionId(sections, 40, false)).toBe("weights");
  });

  it("picks the last section at the bottom of the page, even if it never reached the line", () => {
    expect(activeSectionId(sections, 100, true)).toBe("account");
  });

  it("falls back to the first section above everything", () => {
    expect(
      activeSectionId(
        [
          { id: "a", top: 300 },
          { id: "b", top: 900 },
        ],
        100,
        false
      )
    ).toBe("a");
    expect(activeSectionId([], 100, true)).toBeNull();
  });
});

describe("atPageBottom", () => {
  it("is true within 2px of the end of a scrollable page", () => {
    expect(atPageBottom(1100, 900, 2000)).toBe(true);
    expect(atPageBottom(1097, 900, 2000)).toBe(false);
  });

  it("is false for a page that does not scroll", () => {
    expect(atPageBottom(0, 900, 900)).toBe(false);
  });
});
