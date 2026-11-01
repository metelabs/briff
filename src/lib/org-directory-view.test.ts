import { describe, expect, it } from "vitest";

import { orgHref, orgPage, parseOrgQuery, type OrgRow } from "./org-directory-view";

const row = (i: number, over: Partial<OrgRow> = {}): OrgRow => ({
  id: `o${String(i).padStart(2, "0")}`,
  name: `Org ${i}`,
  createdAt: new Date(Date.UTC(2026, 0, 1 + i)),
  ownerEmail: `owner${i}@example.com`,
  members: 1,
  repos: 3,
  streams: 1,
  plan: "free",
  planSource: "default",
  subscription: null,
  repoOverride: null,
  streamOverride: null,
  repoLimit: 10,
  streamLimit: 2,
  ...over,
});

describe("orgPage", () => {
  const rows = Array.from({ length: 30 }, (_, i) => row(i + 1));
  rows[4] = row(5, { repos: 10 });
  rows[9] = row(10, { streamOverride: 5, streamLimit: 5 });
  // Unlimited never counts as at the limit, however much it uses.
  rows[14] = row(15, { plan: "unlimited", repos: 400, repoLimit: null, streamLimit: null });
  rows[19] = row(20, { name: "Acme Studio", ownerEmail: "Lead@Acme.example" });

  it("pages 25 rows at a time, newest first, and clamps the page", () => {
    const first = orgPage(rows, { q: "", filter: "all", page: 1 });
    expect(first).toMatchObject({ total: 30, pages: 2, page: 1 });
    expect(first.rows).toHaveLength(25);
    expect(first.rows[0].name).toBe("Org 30");
    const last = orgPage(rows, { q: "", filter: "all", page: 9 });
    expect(last.page).toBe(2);
    expect(last.rows.map((r) => r.name)).toEqual(["Org 5", "Org 4", "Org 3", "Org 2", "Org 1"]);
  });

  it("searches name and owner email case-insensitively", () => {
    expect(orgPage(rows, { q: "acme", filter: "all", page: 1 }).rows.map((r) => r.id)).toEqual([
      "o20",
    ]);
    expect(orgPage(rows, { q: "lead@", filter: "all", page: 1 }).total).toBe(1);
  });

  it("filters orgs at a limit and orgs with custom limits, and counts both", () => {
    const res = orgPage(rows, { q: "", filter: "at-limit", page: 1 });
    expect(res.rows.map((r) => r.id)).toEqual(["o05"]);
    expect(res.counts).toEqual({ all: 30, "at-limit": 1, custom: 1 });
    expect(orgPage(rows, { q: "", filter: "custom", page: 1 }).rows.map((r) => r.id)).toEqual([
      "o10",
    ]);
  });

  it("shows a single-org instance as one row on one page", () => {
    expect(orgPage([row(1)], { q: "", filter: "all", page: 1 })).toMatchObject({
      total: 1,
      pages: 1,
      page: 1,
    });
  });
});

describe("parseOrgQuery / orgHref", () => {
  it("falls back to defaults and round-trips", () => {
    expect(parseOrgQuery({ filter: "nope", page: "-2" })).toEqual({
      q: "",
      filter: "all",
      page: 1,
    });
    const q = parseOrgQuery({ q: " acme ", filter: "custom", page: "3" });
    expect(q).toEqual({ q: "acme", filter: "custom", page: 3 });
    expect(orgHref(q)).toBe("/admin?q=acme&filter=custom&page=3");
    expect(orgHref({ q: "", filter: "all", page: 1 })).toBe("/admin");
  });
});
