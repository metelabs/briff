import { describe, expect, it } from "vitest";

import { loadDocs } from "./build";

describe("docs build", () => {
  it("has no broken links or sections", async () => {
    const docs = await loadDocs();
    expect(docs.problems).toEqual([]);
  });
});
