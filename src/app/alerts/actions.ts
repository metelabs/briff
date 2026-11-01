"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { enqueueGithubScan } from "@/lib/github/flow";
import { activeInstallationIds, githubScanInFlight } from "@/lib/github/recheck";
import { plural } from "@/lib/format";
import { loadStreamScope, repoScope } from "@/lib/stream-scope";
import { REVIEWABLE } from "@/pipeline/alert-review";
import { RECHECK_INTERVAL_MS, recheckWaitMs } from "@/pipeline/alert-sections";

export interface ReviewState {
  ok: boolean;
  message: string | null;
}

const packageSchema = z.string().trim().min(1).max(214);

function revalidateAlerts(): void {
  revalidatePath("/alerts");
  revalidatePath("/");
}

/** Every unreviewed first-scan backlog alert of the org; new alerts are never touched. */
export async function markBacklogReviewedAction(): Promise<ReviewState> {
  const ctx = await requireOrgContext();
  const db = withOrg(getDb(), ctx.orgId);
  const res = await db.alert.updateMany({
    where: { ...REVIEWABLE },
    data: { reviewedAt: new Date() },
  });
  revalidateAlerts();
  return {
    ok: true,
    message: res.count > 0 ? "Backlog marked as reviewed." : "No backlog left to review.",
  };
}

/** One package's unreviewed backlog alerts in the repos of the stream picked in the top bar. */
export async function markPackageReviewedAction(
  _prev: ReviewState,
  form: FormData
): Promise<ReviewState> {
  const ctx = await requireOrgContext();
  const name = packageSchema.safeParse(form.get("packageName") ?? "");
  if (!name.success) return { ok: false, message: "Unknown package." };
  const scope = await loadStreamScope(ctx.orgId);
  const db = withOrg(getDb(), ctx.orgId);
  const res = await db.alert.updateMany({
    where: { ...REVIEWABLE, repo: repoScope(scope), advisory: { package: { name: name.data } } },
    data: { reviewedAt: new Date() },
  });
  revalidateAlerts();
  return res.count > 0
    ? { ok: true, message: `${name.data} marked as reviewed.` }
    : { ok: false, message: `${name.data} has no backlog left to review.` };
}

export interface RecheckState {
  ok: boolean;
  /** A GitHub App scan of the org is queued or running. */
  checking: boolean;
  message: string | null;
}

/**
 * "Re-check now": a forced scan of every GitHub App installation of the org (the same
 * github-scan job a push queues; ingestion resolves fixed alerts). At most one per
 * RECHECK_INTERVAL_MS per org; repos uploaded by briff-scan cannot be reached from here.
 */
export async function recheckAction(): Promise<RecheckState> {
  const ctx = await requireOrgContext();
  const installations = await activeInstallationIds(getDb(), ctx.orgId);
  if (installations.length === 0) {
    return {
      ok: false,
      checking: false,
      message: "No repos are connected through the GitHub App.",
    };
  }
  const now = new Date();
  const claimed = await getDb().org.updateMany({
    where: {
      id: ctx.orgId,
      OR: [
        { recheckRequestedAt: null },
        { recheckRequestedAt: { lte: new Date(now.getTime() - RECHECK_INTERVAL_MS) } },
      ],
    },
    data: { recheckRequestedAt: now },
  });
  if (claimed.count === 0) {
    if (await githubScanInFlight(getDb(), installations))
      return { ok: true, checking: true, message: null };
    const org = await getDb().org.findUnique({
      where: { id: ctx.orgId },
      select: { recheckRequestedAt: true },
    });
    const minutes = Math.max(
      1,
      Math.ceil(recheckWaitMs(org?.recheckRequestedAt ?? null, now) / 60_000)
    );
    return {
      ok: false,
      checking: false,
      message: `Re-checked less than 10 minutes ago. You can re-check again in ${plural(minutes, "minute")}.`,
    };
  }
  for (const installationId of installations) {
    await enqueueGithubScan(getDb(), { installationId, force: true });
  }
  return { ok: true, checking: true, message: null };
}

/** Polled while "Checking…" shows. */
export async function recheckStatusAction(): Promise<{ checking: boolean }> {
  const ctx = await requireOrgContext();
  const installations = await activeInstallationIds(getDb(), ctx.orgId);
  return { checking: await githubScanInFlight(getDb(), installations) };
}
