import { describe, expect, it } from "vitest";

import { SAMPLE_BULLETIN } from "./sample-bulletin";
import { sampleAlerts, sampleStack } from "./sample-screens";

// The Stack and Alerts samples must tell the same story as the sample bulletin.

describe("landing sample screens", () => {
  it("shows a Stack card for each of the bulletin's repos", () => {
    const bulletinRepos = new Set(
      [...SAMPLE_BULLETIN.act, ...SAMPLE_BULLETIN.know].flatMap((i) => i.affectedRepos)
    );
    expect(
      sampleStack()
        .map((c) => c.repo)
        .sort()
    ).toEqual([...bulletinRepos].sort());
  });

  it("never sends a repo across a major in the Stack targets", () => {
    for (const card of sampleStack()) {
      for (const e of card.entries) {
        if (e.status === "minor") expect(e.target).toMatch(/^Latest in your line: /);
        if (e.status === "major") expect(e.target).toMatch(/is a major upgrade$/);
      }
    }
  });

  it("groups the bulletin's advisories with the same fixes", () => {
    const groups = sampleAlerts();
    expect(groups.map((g) => g.packageName)).toEqual(
      SAMPLE_BULLETIN.alerts.map((a) => a.packageName)
    );
    for (const alert of SAMPLE_BULLETIN.alerts) {
      const group = groups.find((g) => g.packageName === alert.packageName);
      expect(group?.direct).toBe(!alert.transitive);
      expect(group?.repos).toEqual(alert.repos);
      if (alert.fixed) {
        expect(group?.fixes.map((f) => f.command)).toEqual([
          `npm i ${alert.packageName}@${alert.fixed}`,
        ]);
      }
    }
  });
});
