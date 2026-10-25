import { describe, expect, it } from "vitest";

import { PUBLIC_REPLAY_IDS, publicReplay, replayHighlights } from "./public";
import { SCENARIOS } from "./scenarios";

// What the landing page and /replay/<id> take from the replays.

describe("public replays", () => {
  it("are the committed scenarios", () => {
    for (const id of PUBLIC_REPLAY_IDS) expect(publicReplay(id).scenario).toBe(SCENARIOS[id]);
  });

  it("pairs each urgent email with the fact that triggered it", () => {
    const php = replayHighlights(publicReplay("php2shell"));
    expect(php.map((h) => [h.email.at.toISOString(), h.email.delayMinutes])).toEqual([
      ["2026-10-20T21:00:00.000Z", 28],
      ["2026-10-21T14:00:00.000Z", 26],
    ]);
    const node = replayHighlights(publicReplay("node-oct-2026"));
    expect(node.map((h) => [h.email.at.toISOString(), h.email.delayMinutes])).toEqual([
      ["2026-10-14T15:00:00.000Z", 55],
      ["2026-10-21T13:00:00.000Z", 52],
    ]);
  });

  it("hands the landing page a weekly view with per-repo upgrades", () => {
    const weekly = publicReplay("php2shell").entries.find((e) => e.briffEmail?.kind === "weekly");
    const view = weekly?.briffEmail?.view;
    expect(view?.act.map((i) => i.affectedRepos)).toEqual([
      ["api", "garden.example", "legacy-shop"],
    ]);
    expect(view?.act[0].upgrades.map((u) => [u.repo, u.target])).toEqual([
      ["api", "8.4.27"],
      ["garden.example", "8.3.36"],
      ["legacy-shop", "8.2.35"],
    ]);
  });
});
