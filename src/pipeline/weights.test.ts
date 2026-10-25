import { describe, expect, it } from "vitest";

import { applyFeedbackChange, feedbackDeltas, itemWeight, parseWeights } from "./weights";

const keys = {
  packages: ["next"],
  services: ["nextjs"],
  source: "Vercel blog",
  topic: "breaking_or_feature",
};

describe("feedback → weights", () => {
  it("up raises, down lowers the specific keys more, less lowers everything", () => {
    expect(feedbackDeltas("up", keys)).toEqual({
      "package:next": 1,
      "service:nextjs": 1,
      "source:Vercel blog": 0.5,
      "topic:breaking_or_feature": 0.5,
    });
    expect(feedbackDeltas("down", keys)["package:next"]).toBe(-1);
    expect(feedbackDeltas("down", keys)["source:Vercel blog"]).toBe(-0.5);
    expect(feedbackDeltas("less", keys)["source:Vercel blog"]).toBe(-1);
  });

  it("replacing feedback reverses the previous delta; clearing returns to zero", () => {
    const up = applyFeedbackChange({}, keys, null, "up");
    expect(up["package:next"]).toBe(1);
    const down = applyFeedbackChange(up, keys, "up", "down");
    expect(down).toEqual({
      "package:next": -1,
      "service:nextjs": -1,
      "source:Vercel blog": -0.5,
      "topic:breaking_or_feature": -0.5,
    });
    expect(applyFeedbackChange(down, keys, "down", null)).toEqual({});
  });

  it("clamps to ±5 and leaves other keys alone", () => {
    let w: Record<string, number> = { "package:expo": 2 };
    for (let i = 0; i < 8; i++) w = applyFeedbackChange(w, keys, null, "less");
    expect(w["package:next"]).toBe(-5);
    expect(w["package:expo"]).toBe(2);
  });

  it("sums the weights that apply to an item and ignores junk in stored JSON", () => {
    expect(itemWeight({ "package:next": 2, "source:Vercel blog": -1, other: 9 }, keys)).toBe(1);
    expect(parseWeights({ a: 1, b: "x", c: null })).toEqual({ a: 1 });
    expect(parseWeights([1, 2])).toEqual({});
  });
});
