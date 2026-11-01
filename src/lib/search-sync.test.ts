import { describe, expect, it } from "vitest";

import { initialSearch, searchSync, withSearch, type SearchSyncEvent } from "./search-sync";

const run = (q: string, events: SearchSyncEvent[]) => events.reduce(searchSync, initialSearch(q));

describe("searchSync", () => {
  it("keeps typing that continued after the debounced navigation", () => {
    const s = run("", [
      { type: "edit", value: "stu" },
      { type: "navigate", q: "stu" },
      { type: "edit", value: "studio" },
      { type: "url", q: "stu" },
    ]);
    expect(s).toEqual({ value: "studio", synced: "stu", pushed: null });
  });

  it("follows Back and Forward after searching, filtering and searching again", () => {
    // alpha, then a filter link (same q), then beta.
    let s = run("", [
      { type: "edit", value: "alpha" },
      { type: "navigate", q: "alpha" },
      { type: "url", q: "alpha" },
      { type: "edit", value: "beta" },
      { type: "navigate", q: "beta" },
      { type: "url", q: "beta" },
    ]);
    s = searchSync(s, { type: "url", q: "alpha" });
    expect(s.value).toBe("alpha");
    s = searchSync(s, { type: "url", q: "beta" });
    expect(s.value).toBe("beta");
  });

  it("does not wait for a navigation to the query already shown", () => {
    const s = run("acme", [
      { type: "navigate", q: "acme" },
      { type: "url", q: "x" },
    ]);
    expect(s).toEqual({ value: "x", synced: "x", pushed: null });
  });
});

describe("withSearch", () => {
  it("keeps the current filter, sets or clears q and resets the page", () => {
    expect(withSearch("/admin", "?filter=custom&page=3", "acme")).toBe(
      "/admin?filter=custom&q=acme"
    );
    expect(withSearch("/admin", "?q=acme&page=2", "")).toBe("/admin");
  });
});
