import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";
import { enqueueJob } from "@/lib/jobs/queue";

import { githubScanKey, type GithubScanPayload } from "./scan";
import type { GithubFlowStatus } from "./status";

// Shared by the install/setup/callback routes: where they send the browser back to, and the
// scan a linked installation gets.

/** `/repos?github=<status>` on the public origin; the Repos page shows a line per status. */
export function reposUrl(status: GithubFlowStatus): URL {
  const url = new URL("/repos", getEnv().BETTER_AUTH_URL);
  url.searchParams.set("github", status);
  return url;
}

export function enqueueGithubScan(db: PrismaClient, payload: GithubScanPayload) {
  return enqueueJob(db, "github-scan", {
    payload: { ...payload },
    dedupeKey: githubScanKey(payload),
    maxAttempts: 6,
  });
}
