import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import {
  RUNTIME_ITEM_LOOKBACK_MS,
  RUNTIME_SECURITY_REASON,
  parseRuntimeMeta,
  runtimeItemWindow,
} from "@/lib/runtime-security";

import { SCORES } from "./matcher";

// collect-sources matches an item to orgs only when the item is new, so a repo that
// declares the runtime later (a later scan chunk, a repo included later) would never
// reach the item. Reconciliation is state, not an event: every completed scan and every
// collect urgent pass recompute, per open runtime security item, the included repos whose
// runtime rows name the item's runtime, and add the missing ones to `ItemMatch.repoIds`.
// Repos are never removed (a repo the email already named stays named). The urgent pass
// then emails the repos missing from `urgentRepoIds` as one follow-up
// (src/pipeline/runtime-urgent.ts). Idempotent: a second run writes nothing.

export interface ReconcileResult {
  created: number;
  /** Matches that gained repos. */
  updated: number;
}

/** Repos of `wanted` missing from `existing`, appended in a stable order; null when none. */
export function addedRepoIds(
  existing: readonly string[],
  wanted: readonly string[]
): string[] | null {
  const have = new Set(existing);
  const added = [...new Set(wanted)].filter((id) => !have.has(id)).sort();
  return added.length > 0 ? [...existing, ...added] : null;
}

function stringIds(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

/**
 * Brings the org's matches of open runtime security items (≤ URGENT_MAX_AGE_HOURS since
 * published or since `fixAddedAt`) up to date with its included repos. Three queries per
 * org whatever the number of items: the items, the runtime rows, the matches.
 */
export async function reconcileRuntimeMatches(
  db: PrismaClient,
  orgId: string,
  now: Date = new Date()
): Promise<ReconcileResult> {
  const result: ReconcileResult = { created: 0, updated: 0 };
  const since = new Date(now.getTime() - RUNTIME_ITEM_LOOKBACK_MS);
  const candidates = await db.item.findMany({
    where: {
      source: { class: "security", runtime: { not: null } },
      triage: { reason: RUNTIME_SECURITY_REASON },
      OR: [{ publishedAt: { gte: since } }, { publishedAt: null, createdAt: { gte: since } }],
    },
    select: {
      id: true,
      publishedAt: true,
      createdAt: true,
      metadata: true,
      source: { select: { runtime: true, serviceId: true } },
    },
  });
  const items = candidates.filter((item) => {
    const window = runtimeItemWindow(item, parseRuntimeMeta(item.metadata), now);
    return window.itemRecent || window.fixRecent;
  });
  if (items.length === 0) return result;

  const scoped = withOrg(db, orgId);
  const runtimes = [...new Set(items.map((i) => i.source.runtime as string))];
  const rows = await scoped.repoRuntime.findMany({
    where: { name: { in: runtimes }, repo: { included: true } },
    select: { repoId: true, name: true },
  });
  const reposOf = new Map<string, string[]>();
  for (const row of rows) reposOf.set(row.name, [...(reposOf.get(row.name) ?? []), row.repoId]);

  const existing = await scoped.itemMatch.findMany({
    where: { itemId: { in: items.map((i) => i.id) } },
    select: { id: true, itemId: true, repoIds: true, reason: true, score: true },
  });
  const byItem = new Map(existing.map((m) => [m.itemId, m]));

  const fresh = [];
  for (const item of items) {
    const runtime = item.source.runtime as string;
    const wanted = reposOf.get(runtime);
    if (!wanted) continue;
    const reason = `runtime:${runtime}`;
    const match = byItem.get(item.id);
    if (!match) {
      fresh.push({
        orgId,
        itemId: item.id,
        packageId: null,
        serviceId: item.source.serviceId,
        repoIds: addedRepoIds([], wanted) ?? [],
        reason,
        score: SCORES.runtime,
      });
      continue;
    }
    const repoIds = addedRepoIds(stringIds(match.repoIds), wanted);
    // The urgent pass only reads runtime matches; a match made through a package or service
    // of the same source becomes one once a repo declares the runtime.
    const toRuntime = !match.reason.startsWith("runtime:");
    if (!repoIds && !toRuntime) continue;
    await scoped.itemMatch.update({
      where: { id: match.id },
      data: {
        ...(repoIds ? { repoIds } : {}),
        ...(toRuntime ? { reason, score: Math.max(match.score, SCORES.runtime) } : {}),
      },
    });
    result.updated++;
  }
  if (fresh.length > 0) {
    result.created = (
      await scoped.itemMatch.createMany({ data: fresh, skipDuplicates: true })
    ).count;
  }
  return result;
}
