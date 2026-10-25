import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  parseRuntimeMeta,
  runtimeMetaFromText,
  type RuntimeItemMeta,
} from "@/lib/runtime-security";
import { RULE_TRIAGE_MAX_AGE_DAYS } from "@/pipeline/runtime-urgent";

import type { CollectedItem } from "./fetch-source";
import { fetchPostBody, postBodyUrl, type PostBodyFetcher } from "./post-body";

// Runtime security announcements (feed posts, not GitHub advisories) are edited in
// place: the Node.js pre-announcement becomes the release post on release day, same
// URL and title, now with fixed versions and per-CVE affected lines. Items are
// deduplicated by URL + title, so without this the stored item would keep the
// pre-release text forever. Here a changed body updates the item (text and metadata,
// re-extracted; id, guid and contentHash stay), and the first fixed versions stamp
// `fixAddedAt`, which the urgent pass turns into one "fix is out" follow-up per match.

export interface AnnouncementSourceRef {
  id: string;
  kind: string;
  class: string;
  runtime: string | null;
}

export interface AnnouncementResult {
  /** Items not stored yet (bodies filled in where the feed has none); the caller creates them. */
  fresh: CollectedItem[];
  updated: number;
  /** Updates that brought the first fixed versions. */
  fixReleased: number;
  bodyFetches: number;
}

export function isAnnouncementSource(source: AnnouncementSourceRef): boolean {
  return source.kind === "rss" && source.class === "security" && source.runtime !== null;
}

/** Pure: the metadata after a body change, and whether it brought the first fixed versions. */
export function updatedAnnouncementMeta(
  previous: RuntimeItemMeta,
  title: string,
  text: string,
  now: Date
): { meta: RuntimeItemMeta; fixAdded: boolean } {
  const next = runtimeMetaFromText(title, text);
  const fixAdded = previous.fixedVersions.length === 0 && next.fixedVersions.length > 0;
  const fixAddedAt = fixAdded ? now.toISOString() : previous.fixAddedAt;
  return { meta: { ...next, ...(fixAddedAt ? { fixAddedAt } : {}) }, fixAdded };
}

function young(item: { publishedAt: Date | null; createdAt?: Date }, now: Date): boolean {
  const at = item.publishedAt ?? item.createdAt ?? now;
  return now.getTime() - at.getTime() <= RULE_TRIAGE_MAX_AGE_DAYS * 86_400_000;
}

interface StoredAnnouncement {
  id: string;
  title: string;
  rawText: string;
  metadata: Prisma.JsonValue;
}

async function applyText(
  db: PrismaClient,
  stored: StoredAnnouncement,
  text: string,
  now: Date,
  result: AnnouncementResult
): Promise<void> {
  const previous = parseRuntimeMeta(stored.metadata);
  if (!previous || previous.kind !== "announcement") return;
  if (text.length === 0 || text === stored.rawText) return;
  const { meta, fixAdded } = updatedAnnouncementMeta(previous, stored.title, text, now);
  await db.item.update({
    where: { id: stored.id },
    data: { rawText: text, metadata: meta as Prisma.InputJsonValue },
  });
  result.updated++;
  if (fixAdded) result.fixReleased++;
}

/**
 * Reconciles one feed fetch of a runtime security source: fresh items get their post
 * body when the feed has none, stored announcements whose feed body changed are updated.
 * Posts whose body lives elsewhere (postBodyUrl) are refreshed by refreshOpenAnnouncements.
 */
export async function reconcileAnnouncements(
  db: PrismaClient,
  sourceId: string,
  items: CollectedItem[],
  now: Date,
  fetchBody: PostBodyFetcher = fetchPostBody
): Promise<AnnouncementResult> {
  const result: AnnouncementResult = { fresh: [], updated: 0, fixReleased: 0, bodyFetches: 0 };
  const stored = await db.item.findMany({
    where: { contentHash: { in: items.map((i) => i.contentHash) } },
    select: {
      id: true,
      sourceId: true,
      contentHash: true,
      title: true,
      rawText: true,
      metadata: true,
    },
  });
  const byHash = new Map(stored.map((s) => [s.contentHash, s]));
  for (const item of items) {
    const existing = byHash.get(item.contentHash);
    const bodyUrl = postBodyUrl(item.url);
    if (!existing) {
      // Old posts of a newly added feed stay as they are: only young ones are worth a fetch.
      if (bodyUrl && young(item, now)) {
        result.bodyFetches++;
        const body = await fetchBody(bodyUrl);
        result.fresh.push(body ? { ...item, rawText: body } : item);
      } else {
        result.fresh.push(item);
      }
      continue;
    }
    if (bodyUrl || existing.sourceId !== sourceId) continue;
    await applyText(db, existing, item.rawText, now, result);
  }
  return result;
}

/**
 * Re-reads the body of every open announcement of the source (no fixed versions yet,
 * younger than the triage window) whose post lives at a postBodyUrl. Runs on every
 * fetch, a 304 included: an in-place edit of the post does not always change the feed.
 */
export async function refreshOpenAnnouncements(
  db: PrismaClient,
  sourceId: string,
  now: Date,
  fetchBody: PostBodyFetcher = fetchPostBody
): Promise<AnnouncementResult> {
  const result: AnnouncementResult = { fresh: [], updated: 0, fixReleased: 0, bodyFetches: 0 };
  const since = new Date(now.getTime() - RULE_TRIAGE_MAX_AGE_DAYS * 86_400_000);
  const candidates = await db.item.findMany({
    where: {
      sourceId,
      metadata: { path: ["kind"], equals: "announcement" },
      OR: [{ publishedAt: { gte: since } }, { publishedAt: null, createdAt: { gte: since } }],
    },
    select: { id: true, url: true, title: true, rawText: true, metadata: true },
  });
  for (const item of candidates) {
    const meta = parseRuntimeMeta(item.metadata);
    if (!meta || meta.fixedVersions.length > 0) continue;
    const bodyUrl = postBodyUrl(item.url);
    if (!bodyUrl) continue;
    result.bodyFetches++;
    const body = await fetchBody(bodyUrl);
    if (body) await applyText(db, item, body, now, result);
  }
  return result;
}
