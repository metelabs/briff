"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { enqueueGithubScan } from "@/lib/github/flow";
import { activeInstallationIds, recheckInFlight } from "@/lib/github/recheck";
import { enqueueJob } from "@/lib/jobs/queue";
import { plural } from "@/lib/format";
import { loadStreamScope, repoScope } from "@/lib/stream-scope";
import { REVIEWABLE } from "@/pipeline/alert-review";
import { RECHECK_INTERVAL_MS, recheckWaitMs } from "@/pipeline/alert-sections";
import { orgSecurityScanKey } from "@/security/plan";

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
  /** A scan of the re-check (GitHub App or the org's security-scan) is queued or running. */
  checking: boolean;
  message: string | null;
}

/**
 * "Re-check now": a forced scan of every GitHub App installation of the org (the same
 * github-scan job a push queues; ingestion resolves fixed alerts) and a security-scan of
 * the org's repos only, which asks OSV again about every stored version (briff-scan repos
 * included) and resolves what it no longer reports. At most one per RECHECK_INTERVAL_MS per org.
 */
export async function recheckAction(): Promise<RecheckState> {
  const ctx = await requireOrgContext();
  const db = getDb();
  if ((await withOrg(db, ctx.orgId).repo.count()) === 0) {
    return { ok: false, checking: false, message: "No repos to re-check yet." };
  }
  const installations = await activeInstallationIds(db, ctx.orgId);
  const now = new Date();
  const claimed = await db.org.updateMany({
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
    if (await recheckInFlight(db, ctx.orgId, installations))
      return { ok: true, checking: true, message: null };
    const org = await db.org.findUnique({
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
    await enqueueGithubScan(db, { installationId, force: true });
  }
  await enqueueJob(db, "security-scan", {
    payload: { orgId: ctx.orgId, manual: true },
    dedupeKey: orgSecurityScanKey(ctx.orgId),
    maxAttempts: 3,
  });
  return { ok: true, checking: true, message: null };
}

/** Polled while "Checking…" shows. */
export async function recheckStatusAction(): Promise<{ checking: boolean }> {
  const ctx = await requireOrgContext();
  const installations = await activeInstallationIds(getDb(), ctx.orgId);
  return { checking: await recheckInFlight(getDb(), ctx.orgId, installations) };
}
