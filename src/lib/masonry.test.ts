import { describe, expect, it } from "vitest";

import { distribute } from "./masonry";

describe("distribute", () => {
  it("fills the shortest column in order", () => {
    // A 2-row card next to an 8-row card: the next cards stack under the short one.
    expect(distribute([340, 700, 200, 150, 300], 2, 12)).toEqual([
      [0, 2, 3],
      [1, 4],
    ]);
  });

  it("puts ties in the left column and keeps one column in order", () => {
    expect(distribute([100, 100, 100], 2, 12)).toEqual([[0, 2], [1]]);
    expect(distribute([5, 1, 9], 1, 12)).toEqual([[0, 1, 2]]);
  });
});
