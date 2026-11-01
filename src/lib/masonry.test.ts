import { describe, expect, it } from "vitest";

import { distribute } from "./masonry";

describe("distribute", () => {
  it("fills the shortest column in order", () => {
    // A 2-row card next to an 8-row card: the next cards stack under the short one.
    expect(distribute([340, 700, 200, 150, 300], 2, 12)).toEqual([
      { column: 0, top: 0 },
      { column: 1, top: 0 },
      { column: 0, top: 352 },
      { column: 0, top: 564 },
      { column: 1, top: 712 },
    ]);
  });

  it("puts ties in the left column and keeps one column in order", () => {
    expect(distribute([100, 100, 100], 2, 12).map((p) => p.column)).toEqual([0, 1, 0]);
    expect(distribute([5, 1, 9], 1, 12)).toEqual([
      { column: 0, top: 0 },
      { column: 0, top: 17 },
      { column: 0, top: 30 },
    ]);
  });
});
