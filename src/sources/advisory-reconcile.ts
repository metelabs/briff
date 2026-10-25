import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { emailsImmediately, parseRuntimeMeta } from "@/lib/runtime-security";

import type { CollectedItem } from "./fetch-source";

// GitHub advisories are edited after publication (patched versions added, severity
// corrected, summary reworded). Items are deduplicated by URL + title, so an edit
// would be skipped or create a second item. Advisory items are reconciled by their
// GHSA id instead: one item per guid, updated in place when the advisory changed.

export interface ReconcileResult {
  /** Advisories not stored yet; the caller creates them. */
  fresh: CollectedItem[];
  updated: number;
  /** Advisories raised from medium/low to critical/high/unknown: their handled matches reopen. */
  escalated: number;
}

/**
 * Re-alert rule: an edit never re-sends an email, except when the severity rises from
 * below the email threshold (medium/low) to critical, high or unknown. Matches of such
 * an advisory were only marked handled (never emailed), so they go back to pending.
 */
export function reopensUrgent(previous: unknown, next: unknown): boolean {
  const before = parseRuntimeMeta(previous);
  const after = parseRuntimeMeta(next);
  return (
    before !== null && after !== null && !emailsImmediately(before) && emailsImmediately(after)
  );
}

function changed(
  existing: { contentHash: string; metadata: Prisma.JsonValue },
  item: CollectedItem
): boolean {
  const before = parseRuntimeMeta(existing.metadata);
  return (
    existing.contentHash !== item.contentHash ||
    before?.updatedAt !== item.metadata?.updatedAt ||
    JSON.stringify(before?.fixedVersions) !== JSON.stringify(item.metadata?.fixedVersions) ||
    before?.severity !== item.metadata?.severity
  );
}

export async function reconcileAdvisories(
  db: PrismaClient,
  sourceId: string,
  items: CollectedItem[]
): Promise<ReconcileResult> {
  const result: ReconcileResult = { fresh: [], updated: 0, escalated: 0 };
  const guids = items.flatMap((i) => (i.guid ? [i.guid] : []));
  const existing = await db.item.findMany({
    where: { sourceId, guid: { in: guids } },
    orderBy: { createdAt: "asc" },
    select: { id: true, guid: true, contentHash: true, metadata: true },
  });
  const byGuid = new Map<string, (typeof existing)[number]>();
  for (const e of existing) if (e.guid && !byGuid.has(e.guid)) byGuid.set(e.guid, e);

  const reopen: string[] = [];
  for (const item of items) {
    const stored = item.guid ? byGuid.get(item.guid) : undefined;
    if (!stored) {
      result.fresh.push(item);
      continue;
    }
    if (!changed(stored, item)) continue;
    // Another item already has this url + title (contentHash is unique): keep the stored one.
    const clash = await db.item.count({
      where: { contentHash: item.contentHash, id: { not: stored.id } },
    });
    if (clash > 0) continue;
    await db.item.update({
      where: { id: stored.id },
      data: {
        title: item.title,
        url: item.url,
        publishedAt: item.publishedAt,
        rawText: item.rawText,
        contentHash: item.contentHash,
        metadata: item.metadata as Prisma.InputJsonValue,
      },
    });
    result.updated++;
    if (reopensUrgent(stored.metadata, item.metadata)) reopen.push(stored.id);
  }

  if (reopen.length > 0) {
    result.escalated = reopen.length;
    const orgs = await db.org.findMany({ select: { id: true } });
    for (const org of orgs) {
      await withOrg(db, org.id).itemMatch.updateMany({
        where: { itemId: { in: reopen }, urgentAt: { not: null } },
        data: { urgentAt: null },
      });
    }
  }
  return result;
}
