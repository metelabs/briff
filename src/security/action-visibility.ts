import { enqueueJob } from "@/lib/jobs/queue";
import { ActionVisibilityDeferred, isPublicAction } from "@/sources/github-actions";
import type { JobContext } from "@/worker/types";

const CACHE_MS = 24 * 60 * 60_000;

/** Check unknown repositories first so each resumed pass advances through the stack. */
export async function publicActionsForScan(
  { db, log, heartbeat }: Pick<JobContext, "db" | "log" | "heartbeat">,
  names: readonly string[]
): Promise<Set<string>> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - CACHE_MS);
  const rows = await db.package.findMany({
    where: { ecosystem: "GitHub Actions", name: { in: [...new Set(names)] } },
    select: {
      id: true,
      name: true,
      actionPublic: true,
      actionVisibilityCheckedAt: true,
      actionVisibilityRetryAt: true,
    },
    orderBy: [{ actionVisibilityCheckedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }],
  });
  const publicNames = new Set<string>();
  let deferredAt: Date | undefined;
  for (const row of rows) {
    if (row.actionVisibilityCheckedAt && row.actionVisibilityCheckedAt > cutoff) {
      if (row.actionPublic === true) publicNames.add(row.name);
      continue;
    }
    if (row.actionVisibilityRetryAt && row.actionVisibilityRetryAt > now) {
      if (!deferredAt || row.actionVisibilityRetryAt < deferredAt)
        deferredAt = row.actionVisibilityRetryAt;
      continue;
    }
    await heartbeat();
    try {
      const isPublic = await isPublicAction(row.name);
      await db.package.update({
        where: { id: row.id },
        data: {
          actionPublic: isPublic,
          actionVisibilityCheckedAt: now,
          actionVisibilityRetryAt: null,
        },
      });
      if (isPublic) publicNames.add(row.name);
    } catch (err) {
      const retryAt =
        err instanceof ActionVisibilityDeferred
          ? err.retryAt
          : new Date(now.getTime() + 15 * 60_000);
      const rateLimited = err instanceof ActionVisibilityDeferred;
      await db.package.updateMany({
        where: {
          id: { in: rateLimited ? rows.map((r) => r.id) : [row.id] },
          OR: [{ actionVisibilityCheckedAt: null }, { actionVisibilityCheckedAt: { lte: cutoff } }],
        },
        data: { actionVisibilityRetryAt: retryAt },
      });
      if (rateLimited || !deferredAt || retryAt < deferredAt) deferredAt = retryAt;
      log.warn({ retryAt }, "security: action visibility checks deferred");
      if (rateLimited) break;
    }
  }
  if (deferredAt) {
    await enqueueJob(db, "security-scan", {
      runAfter: deferredAt,
      dedupeKey: `security-scan:action-visibility:${deferredAt.toISOString()}`,
    });
  }
  // Cached public rows after the deferred check still receive advisory coverage.
  for (const row of rows) {
    if (
      row.actionPublic === true &&
      row.actionVisibilityCheckedAt &&
      row.actionVisibilityCheckedAt > cutoff
    )
      publicNames.add(row.name);
  }
  return publicNames;
}
