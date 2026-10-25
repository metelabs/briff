import { describe, expect, it } from "vitest";

import { inScope } from "@/pipeline/bulletin";
import { urgentForOrg } from "@/pipeline/triage";

// removeRepo leaves the removed id in ItemMatch.repoIds. Readers must treat it like a repo
// that is not included; dropping it instead could empty the list, which means "stack-wide".
describe("a removed repo's id left in ItemMatch.repoIds", () => {
  const included = new Map([["kept", "kept-repo"]]);

  it("keeps a match through the remaining repo and drops one reached only through it", () => {
    expect(inScope({ repoIds: ["removed", "kept"], matchReason: "package" }, included)).toBe(true);
    expect(inScope({ repoIds: ["removed"], matchReason: "package" }, included)).toBe(false);
  });

  it("is never named in an urgent email", () => {
    const urgent = ["a", "b"].map((itemId) => ({
      itemId,
      title: itemId,
      url: `https://example.com/${itemId}`,
      sourceName: "S",
      bucket: "security" as const,
      reason: "r",
    }));
    const matches = [
      { itemId: "a", repoIds: ["removed", "kept"] },
      { itemId: "b", repoIds: ["removed"] },
    ];
    expect(urgentForOrg(urgent, matches, included).map((u) => [u.title, u.affectedRepos])).toEqual([
      ["a", ["kept-repo"]],
    ]);
  });
});
