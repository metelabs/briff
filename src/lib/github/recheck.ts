import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";

import { githubScanKeyPrefix } from "./scan";

// "Re-check now" on Alerts: which installations it rescans, and whether their scan is done.

export async function activeInstallationIds(db: PrismaClient, orgId: string): Promise<string[]> {
  const rows = await withOrg(db, orgId).githubInstallation.findMany({
    where: { suspendedAt: null },
    select: { installationId: true },
  });
  return rows.map((r) => r.installationId);
}

/**
 * Whether any scan of the installations is queued or running: the full scan a re-check
 * queues and the per-repo follow-ups it leaves for rate-limited or failed repos.
 */
export async function githubScanInFlight(
  db: PrismaClient,
  installationIds: readonly string[]
): Promise<boolean> {
  if (installationIds.length === 0) return false;
  // Job is a global table; the keys come from the org's own installations.
  const job = await db.job.findFirst({
    where: {
      type: "github-scan",
      status: { in: ["pending", "running"] },
      OR: installationIds.map((installationId) => ({
        dedupeKey: { startsWith: githubScanKeyPrefix(installationId) },
      })),
    },
    select: { id: true },
  });
  return job !== null;
}
