import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { runReplay } from "./engine";
import { delayLabel, renderReplayPage } from "./render";
import { SCENARIOS } from "./scenarios";
import type { ReplayEmail, ReplayResult } from "./types";

// Every real incident gets a replay case: the emails Briff would have sent, in order, at
// which hourly run, and the per-repo actions they carry.

const emailsOf = (r: ReplayResult): ReplayEmail[] =>
  r.entries.flatMap((e) => (e.briffEmail ? [e.briffEmail] : []));

const iso = (d: Date) => d.toISOString();

/** Each urgent email goes out on the first hourly run after the fact that triggered it. */
function expectFirstTickAfterTrigger(r: ReplayResult, m: ReplayEmail): void {
  const clock = r.scenario.clock.map((t) => t.getTime());
  expect(clock).toContain(m.at.getTime());
  const trigger = m.trigger?.at.getTime() ?? Number.NaN;
  expect(clock.find((t) => t > trigger)).toBe(m.at.getTime());
  expect(m.delayMinutes).toBeGreaterThan(0);
  expect(m.delayMinutes).toBeLessThanOrEqual(60);
}

describe("replay: PHP2Shell", () => {
  const result = runReplay(SCENARIOS.php2shell);
  const emails = emailsOf(result);

  it("sends the pre-announcement, the fix email and the weekly act item, in that order", () => {
    expect(emails.map((m) => [m.kind, iso(m.at), m.delayMinutes])).toEqual([
      ["urgent", "2026-10-20T21:00:00.000Z", 28],
      ["urgent", "2026-10-21T14:00:00.000Z", 26],
      ["weekly", "2026-10-26T04:00:00.000Z", null],
    ]);
    expect(emails.map((m) => m.subject)).toEqual([
      "Briff · urgent: Upcoming Critical PHP Security Release",
      "Briff · urgent: Security advisory: Critical remote code execution vulnerabilities, update now",
      "Briff · Weekly · W44: PHP",
    ]);
    for (const m of emails.filter((e) => e.kind === "urgent")) {
      expectFirstTickAfterTrigger(result, m);
    }
    expect(result.untriaged).toEqual([]);
  });

  it("announces the release within the hour of the notice, before any version exists", () => {
    const [pre] = emails;
    expect(pre.trigger).toEqual({
      at: new Date("2026-10-20T20:32:00Z"),
      title: "Upcoming Critical PHP Security Release",
    });
    expect(pre.text).toContain("PHP announced a security release for 21 Oct 2026, 14:00 UTC.");
    expect(pre.todo).toEqual([
      "To do: Update PHP in api, garden.example as soon as the fixed release is out (announced for 21 Oct 2026, 14:00 UTC). · legacy-shop: php 8.1 is end-of-life and will not get this fix; move to 8.2 or later",
    ]);
  });

  it("folds the incident into one PHP block: one action per repo, every item as a source", () => {
    const fix = emails[1];
    // The release went public at 13:40 UTC; the GitHub advisories (13:34) came first.
    expect(fix.trigger?.at).toEqual(new Date("2026-10-21T13:34:13Z"));
    expect(fix.items).toEqual([
      "Security advisory: Critical remote code execution vulnerabilities, update now",
    ]);
    expect(fix.text).toContain("CRITICAL · CVE-2026-109618 · CVE-2026-109619");
    expect(fix.text).toContain("Fixed in: 8.5.12, 8.4.27, 8.3.36, 8.2.35");
    expect(fix.todo).toEqual([
      "To do: api: set php 8.4.27 in .tool-versions",
      "To do: garden.example: rebuild to pick up PHP 8.3.36; the php:8.3-fpm tag already points to it",
      "To do: legacy-shop: php 8.1 is end-of-life and will not get this fix; move to 8.2.35 or later",
    ]);
    expect(fix.sources).toEqual([
      "Sources: " +
        [
          "Security advisory: Critical remote code execution vulnerabilities, update now <https://www.php.net/index.php#2026-10-21-5>",
          "PHP 8.3.36 Released! <https://www.php.net/index.php#2026-10-21-2>",
          "PHP 8.4.27 Released! <https://www.php.net/index.php#2026-10-21-3>",
          "GHSA-6wmf-4rv5-p3rp <https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp>",
          "GHSA-w8hw-w9fx-j79w <https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w>",
        ].join(" · "),
    ]);
    // Each repo is named once; the end-of-life line is never "not affected".
    for (const repo of ["api", "garden.example", "legacy-shop"]) {
      expect(fix.text.split(`To do: ${repo}:`)).toHaveLength(2);
    }
    expect(fix.text).not.toContain("Not affected");
    // 8.2.35 and 8.5.12 release posts concern no line a sample repo runs: not sources.
    expect(fix.text).not.toContain("PHP 8.2.35 Released!");
    expect(fix.text).not.toContain("PHP 8.5.12 Released!");
  });

  it("keeps one weekly act item for PHP, the same headline and actions as the email", () => {
    const weekly = emails[2];
    expect(weekly.items).toEqual(emails[1].items);
    expect(weekly.todo).toEqual([
      "api: set php 8.4.27 in .tool-versions · garden.example: rebuild to pick up PHP 8.3.36; the php:8.3-fpm tag already points to it · legacy-shop: php 8.1 is end-of-life and will not get this fix; move to 8.2.35 or later",
    ]);
    expect(weekly.todo[0].split(" · ")).toEqual(
      emails[1].todo.map((l) => l.slice("To do: ".length))
    );
    expect(weekly.text).toContain("Related: PHP security advisory: RCE via OOM corruption");
    expect(weekly.text).toContain("Upcoming Critical PHP Security Release");
  });
});

describe("replay: Node.js October 2026", () => {
  const result = runReplay(SCENARIOS["node-oct-2026"]);
  const emails = emailsOf(result);

  it("sends the announcement, the weekly item and the fix email, in that order", () => {
    expect(emails.map((m) => [m.kind, iso(m.at), m.delayMinutes])).toEqual([
      ["urgent", "2026-10-14T15:00:00.000Z", 55],
      ["weekly", "2026-10-19T04:00:00.000Z", null],
      ["urgent", "2026-10-21T13:00:00.000Z", 52],
    ]);
    expect(emails.map((m) => m.subject)).toEqual([
      "Briff · urgent: Wednesday, October 21, 2026 Security Releases",
      "Briff · Weekly · W43: Node.js",
      "Briff · urgent · fix released: Wednesday, October 21, 2026 Security Releases",
    ]);
    for (const m of emails.filter((e) => e.kind === "urgent")) {
      expectFirstTickAfterTrigger(result, m);
    }
  });

  it("names the end-of-life lines before the release", () => {
    expect(emails[0].todo).toEqual([
      "To do: Update Node.js in briff, garden.example, sigma/budget, sigma/forms-web as soon as the fixed release is out (announced for 21 Oct 2026). · bakery.example: node 18 is end-of-life and will not get this fix; move to 22 or later · orchid-hotel.example: node 14 is end-of-life and will not get this fix; move to 22 or later",
    ]);
  });

  it("sends the fix follow-up with the actions production sent on 22 Oct 2026", () => {
    const fix = emails[2];
    expect(fix.trigger).toEqual({
      at: new Date("2026-10-21T12:07:59Z"),
      title: "Wednesday, October 21, 2026 Security Releases",
    });
    expect(fix.text).toContain("The fixed Node.js releases are out: 22.23.4, 24.22.1, 26.12.1.");
    expect(fix.todo).toEqual([
      "To do: bakery.example: node 18 is end-of-life and will not get this fix; move to 22.23.4 or later",
      "To do: briff: rebuild to pick up Node.js 22.23.4; the node:22-alpine tag already points to it",
      "To do: garden.example: move Dockerfile to node:22.23.4-alpine",
      "To do: orchid-hotel.example: node 14 is end-of-life and will not get this fix; move to 22.23.4 or later",
      "To do: sigma/budget: rebuild to pick up Node.js 24.22.1; the node:24-slim tag already points to it",
      "To do: sigma/forms-web: move Dockerfile to node:24.22.1-alpine",
    ]);
  });
});

describe("replay page", () => {
  it("formats delays", () => {
    expect([28, 60, 125].map(delayLabel)).toEqual(["+28 min", "+1 h", "+2 h 5 min"]);
  });

  for (const scenario of Object.values(SCENARIOS)) {
    it(`renders ${scenario.id} with every event and email, and matches docs/replay`, () => {
      const result = runReplay(scenario);
      const html = renderReplayPage(result);
      expect(html).toContain("Replay · real items, sample repos, no LLM involved");
      expect(html).toContain("WHAT HAPPENED");
      expect(html).toContain("WHAT BRIFF SENT");
      expect(html.match(/<iframe class="mail-frame"/g)).toHaveLength(emailsOf(result).length);
      expect(html.match(/class="card world"/g)).toHaveLength(scenario.world.length);
      for (const m of emailsOf(result)) {
        if (m.delayMinutes !== null) expect(html).toContain(delayLabel(m.delayMinutes));
      }
      expect(html).toContain(
        `npm run replay -- ${scenario.id} --out docs/replay/${scenario.id}.html`
      );
      // The committed page is the generated one: rerun the script after changing a scenario.
      const committed = readFileSync(
        new URL(`../../docs/replay/${scenario.id}.html`, import.meta.url),
        "utf8"
      );
      expect(committed).toBe(html);
    });
  }
});
