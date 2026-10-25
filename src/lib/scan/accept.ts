import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { enqueueJob, scheduleJob, type EnqueueResult } from "@/lib/jobs/queue";
import { log } from "@/lib/log";

import { scanFollowUp, scanFollowUpKey } from "./follow-up";
import { ingestScan, type RepoIngestResult } from "./ingest";
import type { ScanBody } from "./schema";

export interface AcceptedScan {
  repos: RepoIngestResult[];
  refreshJob: EnqueueResult;
  urgentPass: { id: string; runAfter: Date } | null;
}

/**
 * Everything after authentication for one scan upload, shared by POST /api/scan and the
 * GitHub App scan job: ingest, refresh-packages, and the org's runtime urgent pass, which
 * runs once per scan session (`scanId`, `final` on the last upload; src/lib/scan/follow-up.ts).
 */
export async function acceptScan(
  db: PrismaClient,
  orgId: string,
  body: ScanBody,
  now: Date = new Date()
): Promise<AcceptedScan> {
  const repos = await ingestScan(db, orgId, body, now);
  const refreshJob = await enqueueJob(db, "refresh-packages");
  const followUp = scanFollowUp({ scanId: body.scanId, final: body.final }, now);
  let urgentPass: { id: string; runAfter: Date } | null = null;
  try {
    urgentPass = await scheduleJob(db, "collect-sources", {
      dedupeKey: scanFollowUpKey(orgId),
      runAfter: followUp.runAfter,
      payload: { due: true, rematchOrgId: orgId },
    });
  } catch (err) {
    log.error({ err, orgId }, "scan: scheduling the runtime urgent pass failed");
  }
  return { repos, refreshJob, urgentPass };
}
