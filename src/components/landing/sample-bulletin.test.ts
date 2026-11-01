import { describe, expect, it } from "vitest";

import { strings } from "@/lib/i18n";
import { actionClauses, groupByRepo } from "@/pipeline/bulletin-by-repo";
import { advisoryCount, restCount } from "@/pipeline/bulletin-model";

import { SAMPLE_BULLETIN as view } from "./sample-bulletin";

// The landing page's sample bulletin is static data; keep it a full, consistent week.

describe("landing sample bulletin", () => {
  it("fills every part of the page", () => {
    expect(view.act.map((i) => i.bucket)).toEqual(["security", "deadline"]);
    expect(view.know).toHaveLength(3);
    expect(view.know.every((i) => i.affectedRepos.length > 0)).toBe(true);
    expect(view.alerts).toHaveLength(3);
    expect(advisoryCount(view.alerts)).toBe(3);
    expect(view.alerts.filter((a) => a.transitive).map((a) => a.fixed)).toEqual([null]);
    expect(view.minor).toHaveLength(5);
    expect(restCount(view)).toBe(5);
  });

  it("gives the security item one command per installed line, each repo upgraded on its own line", () => {
    const [security] = view.act;
    const commands = actionClauses(security.action).flatMap((c) =>
      c.kind === "command" ? [[c.command, c.repos]] : []
    );
    expect(commands).toEqual([
      ["npm i next@16.3.8", ["garden.example"]],
      ["npm i next@15.5.12", ["bakery.example"]],
    ]);
    for (const u of security.upgrades) {
      expect(u.target?.split(".")[0]).toBe(u.installed[0].split(".")[0]);
      expect(security.affectedRepos).toContain(u.repo);
    }
  });

  it("has a By repo card for every repo it names", () => {
    const cards = groupByRepo(view, strings(view.language)).flatMap((g) =>
      g.repo ? [g.repo] : []
    );
    expect(cards.sort()).toEqual(["bakery.example", "garden.example", "orchid-hotel.example"]);
  });
});
