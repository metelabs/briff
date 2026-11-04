import { randomInt } from "node:crypto";

// GithubInstallation.installationId is unique across the whole test database, which every
// integration file and CI rerun shares. Timestamp-derived ids collided (a truncated
// `Date.now()` plus a one-digit suffix equals another test's id), so ids are a random
// per-module prefix plus a counter: numeric like GitHub's, and safe for `Number()`.
const prefix = randomInt(1_000_000_000, 10_000_000_000);
let counter = 0;

/** A GitHub installation id no other test or run has linked. */
export function testInstallationId(): string {
  counter += 1;
  return `${prefix}${String(counter).padStart(4, "0")}`;
}
