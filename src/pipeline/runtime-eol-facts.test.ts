import { expect, it } from "vitest";
import { upcomingEolFacts } from "./runtime-eol-facts";

it("derives deterministic upcoming dates only from concrete runtime evidence within 90 days", () => {
  const row = {
    repo: "acme/web",
    name: "php",
    version: "8.2.1",
    normalized: "8.2.1",
    source: "Dockerfile",
    unresolved: false,
  };
  const now = new Date("2026-10-27T23:59:59Z");
  expect(upcomingEolFacts([row, row], now)).toEqual([
    "acme/web: php 8.2 — EOL in 65 days (EOL on 2026-12-31).",
  ]);
  expect(upcomingEolFacts([{ ...row, constraint: true }], now)).toEqual([]);
  expect(upcomingEolFacts([{ ...row, unresolved: true }], now)).toEqual([]);
  expect(upcomingEolFacts([row], new Date("2026-06-01"))).toEqual([]);
  expect(upcomingEolFacts([row], new Date("2027-01-01"))).toEqual([]);
});
