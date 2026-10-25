import { describe, expect, it } from "vitest";

import { isReviewedBacklog, REVIEWABLE, showReviewedParam, splitReviewed } from "./alert-review";

const at = new Date("2026-10-24T12:00:00Z");

describe("backlog review", () => {
  it("hides only reviewed backlog alerts, never new ones", () => {
    expect(isReviewedBacklog({ kind: "backlog", reviewedAt: at })).toBe(true);
    expect(isReviewedBacklog({ kind: "backlog", reviewedAt: null })).toBe(false);
    // A new alert stays visible even if a timestamp ever reached it.
    expect(isReviewedBacklog({ kind: "new", reviewedAt: at })).toBe(false);
  });

  it("splits rows into the default view and the reviewed backlog, order kept", () => {
    const rows = [
      { id: "a", kind: "new", reviewedAt: null },
      { id: "b", kind: "backlog", reviewedAt: at },
      { id: "c", kind: "backlog", reviewedAt: null },
      { id: "d", kind: "new", reviewedAt: at },
    ];
    const { open, reviewed } = splitReviewed(rows);
    expect(open.map((r) => r.id)).toEqual(["a", "c", "d"]);
    expect(reviewed.map((r) => r.id)).toEqual(["b"]);
  });

  it("lets the actions touch unreviewed backlog only", () => {
    expect(REVIEWABLE).toEqual({ kind: "backlog", reviewedAt: null });
  });

  it("reads the Show reviewed toggle", () => {
    expect(showReviewedParam("1")).toBe(true);
    expect(showReviewedParam(["1", "0"])).toBe(true);
    expect(showReviewedParam(undefined)).toBe(false);
    expect(showReviewedParam("0")).toBe(false);
    expect(showReviewedParam("")).toBe(false);
  });
});
