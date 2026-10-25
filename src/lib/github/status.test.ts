import { describe, expect, it } from "vitest";

import { GITHUB_FLOW_MESSAGES, GITHUB_FLOW_STATUSES, isGithubFlowStatus } from "./status";

describe("GitHub flow status", () => {
  it("has a message for every status and recognises only those", () => {
    for (const s of GITHUB_FLOW_STATUSES)
      expect(GITHUB_FLOW_MESSAGES[s].text.length).toBeGreaterThan(10);
    expect(isGithubFlowStatus("connected")).toBe(true);
    expect(isGithubFlowStatus("<script>")).toBe(false);
    expect(isGithubFlowStatus(undefined)).toBe(false);
  });
});
