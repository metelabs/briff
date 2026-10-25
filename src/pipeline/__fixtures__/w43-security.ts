import type { Candidate, SynthesisOutput } from "../bulletin";
import type { RepoFix } from "../fixes";

// The three security items of the W43 production bulletin (synthesis-v7) whose headline
// named the feed release instead of the fix, and the model output as it was written.

export const W43_NOW = new Date("2026-10-26T04:00:00Z");

export const W43_REPOS = new Map([
  ["r-briff", "briff"],
  ["r-budget", "budget"],
  ["r-garden", "garden.example"],
  ["r-mint", "mint-app"],
  ["r-pantheon", "pantheon"],
  ["r-tracker", "tracker"],
  ["r-west", "west.garden.example"],
]);

function release(
  itemId: string,
  pkg: string,
  title: string,
  repoIds: string[],
  rawText: string
): Candidate {
  return {
    itemId,
    contentHash: `hash-${itemId}`,
    title,
    url: `https://github.com/${pkg}/${pkg}/releases`,
    rawText,
    publishedAt: new Date("2026-10-22T10:00:00Z"),
    sourceName: `${pkg}/${pkg} releases`,
    sourceKind: "github_releases",
    bucket: "security",
    score: 0.9,
    matchReason: `release:${pkg}`,
    repoIds,
    keys: { packages: [pkg], services: [], source: `${pkg}/${pkg} releases`, topic: "security" },
    dueAt: null,
    dueWhat: null,
    folded: [],
  };
}

export const W43_CANDIDATES: Candidate[] = [
  release(
    "fastify",
    "fastify",
    "fastify v5.12.6",
    ["r-garden"],
    "Security release. Fixes GHSA-389g-gv7q-r4x8 (content-type parsing)."
  ),
  release(
    "nodemailer",
    "nodemailer",
    "nodemailer v10.1.2",
    ["r-briff", "r-garden", "r-west", "r-mint", "r-pantheon"],
    "Bounds the work done per message and per-message auth."
  ),
  release(
    "undici",
    "undici",
    "undici v8.12.2",
    ["r-tracker", "r-budget"],
    "Fixes TLS certificate checks and two denial-of-service issues."
  ),
];

/** Per package: one entry per (repo, advisory, affected installed version), as summariseAlerts gives. */
export const W43_ALERT_FIXES = new Map<string, RepoFix[]>([
  ["fastify", [{ repo: "garden.example", installed: "5.8.5", fix: "5.12.7", direct: true }]],
  [
    "nodemailer",
    [
      // The advisories are fixed on 10.x only: 9.x has no fix on its own line.
      { repo: "briff", installed: "10.1.1", fix: "10.1.4", direct: true },
      { repo: "garden.example", installed: "9.0.3", fix: "10.1.4", direct: true },
      { repo: "west.garden.example", installed: "9.0.3", fix: "10.1.4", direct: true },
      { repo: "mint-app", installed: "6.9.15", fix: "10.1.4", direct: false },
      { repo: "pantheon", installed: "7.0.11", fix: "10.1.4", direct: false },
    ],
  ],
  [
    "undici",
    [
      { repo: "tracker", installed: "7.22.0", fix: "7.30.1", direct: true },
      { repo: "budget", installed: "6.21.0", fix: "6.23.0", direct: true },
    ],
  ],
]);

/** Refs follow the selection order (rank, then published), see W43 tests. */
export function w43Output(refOf: (itemId: string) => number): SynthesisOutput {
  return {
    summary: "Security fixes for fastify, nodemailer and undici affect your repos.",
    act: [
      {
        ref: refOf("fastify"),
        headline: "Fastify 5.12.6 security release fixes GHSA-389g-gv7q-r4x8",
        line: "The security fix ships in 5.12.7; garden.example runs 5.8.5.",
        action: "npm i fastify@5.12.7",
      },
      {
        ref: refOf("nodemailer"),
        headline: "Nodemailer 10.1.2 bounds message work and per-message auth",
        line: "Nodemailer advisories fixed in 10.1.4 apply to every affected repo.",
        action: "Read before changing nodemailer in every affected repo.",
      },
      {
        ref: refOf("undici"),
        headline: "undici v8.12.2 fixes TLS and denial-of-service security issues",
        line: "undici 7.30.1 advisories also reach tracker and budget.",
        action: "Upgrade undici in every affected repo.",
      },
    ],
    know: [],
  };
}
