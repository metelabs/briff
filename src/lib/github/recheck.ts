import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";

import { githubScanKey } from "./scan";

// "Re-check now" on Alerts: which installations it rescans, and whether their scan is done.

export async function activeInstallationIds(db: PrismaClient, orgId: string): Promise<string[]> {
  const rows = await withOrg(db, orgId).githubInstallation.findMany({
    where: { suspendedAt: null },
    select: { installationId: true },
  });
  return rows.map((r) => r.installationId);
}

/** Whether a full scan of any of the installations is queued or running. */
export async function githubScanInFlight(
  db: PrismaClient,
  installationIds: readonly string[]
): Promise<boolean> {
  if (installationIds.length === 0) return false;
  // Job is a global table; the keys come from the org's own installations.
  const job = await db.job.findFirst({
    where: {
      type: "github-scan",
      dedupeKey: { in: installationIds.map((installationId) => githubScanKey({ installationId })) },
      status: { in: ["pending", "running"] },
    },
    select: { id: true },
  });
  return job !== null;
}
