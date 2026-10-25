import { describe, expect, it } from "vitest";

import { FOLDED_ID, INITIAL_PIVOT, pivotReducer } from "./pivot";

describe("pivotReducer", () => {
  it("opens the folded list when its tile is clicked from By repo", () => {
    const inRepo = pivotReducer(INITIAL_PIVOT, { type: "view", view: "repo" });
    const next = pivotReducer(inRepo, { type: "jump", id: FOLDED_ID, view: "item" });
    expect(next).toEqual({
      view: "item",
      foldedOpen: true,
      target: { id: FOLDED_ID, flash: false },
    });
  });

  it("keeps the folded list open across view switches", () => {
    let s = pivotReducer(INITIAL_PIVOT, { type: "toggleFolded" });
    s = pivotReducer(s, { type: "view", view: "repo" });
    s = pivotReducer(s, { type: "view", view: "item" });
    expect(s.foldedOpen).toBe(true);
  });

  it("other tiles do not open it", () => {
    const s = pivotReducer(INITIAL_PIVOT, { type: "jump", id: "attention", view: "item" });
    expect(s.foldedOpen).toBe(false);
    expect(s.target).toEqual({ id: "attention", flash: false });
  });

  it("a repo chip switches to By repo and flashes the card, then the target is consumed", () => {
    let s = pivotReducer(INITIAL_PIVOT, { type: "repo", anchor: "repo-briff" });
    expect(s).toMatchObject({ view: "repo", target: { id: "repo-briff", flash: true } });
    s = pivotReducer(s, { type: "scrolled" });
    expect(s.target).toBeNull();
  });
});
