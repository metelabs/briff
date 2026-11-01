import { describe, expect, it } from "vitest";

import {
  chipLayout,
  FOLDED_ID,
  hasClickableRepo,
  INITIAL_PIVOT,
  pivotReducer,
  repoNamesOf,
} from "./pivot";

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

describe("repo chips on item rows", () => {
  const cards = new Set(["garden", "west"]);

  it("makes only repos with a By repo card clickable", () => {
    expect(repoNamesOf(["garden", "attic"], cards)).toEqual([
      { repo: "garden", clickable: true },
      { repo: "attic", clickable: false },
    ]);
  });

  it("shows the click hint only when some item names a repo with a card", () => {
    expect(hasClickableRepo([{ affectedRepos: [] }, { affectedRepos: ["attic"] }], cards)).toBe(
      false
    );
    expect(hasClickableRepo([{ affectedRepos: ["attic", "west"] }], cards)).toBe(true);
    expect(hasClickableRepo([], cards)).toBe(false);
  });

  it("folds more than the limit behind a +N chip until expanded", () => {
    const five = ["a", "b", "c", "d", "e"];
    expect(chipLayout(five, 3, false)).toEqual({ shown: ["a", "b"], more: 3 });
    expect(chipLayout(five, 3, true)).toEqual({ shown: five, more: 0 });
    expect(chipLayout(["a", "b", "c"], 3, false)).toEqual({ shown: ["a", "b", "c"], more: 0 });
  });
});
