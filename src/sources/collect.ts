import type { Prisma } from "@/generated/prisma/client";
import { mapLimit } from "@/lib/concurrency";
import { withOrg } from "@/lib/db/with-org";
import { enqueueJob, JobLockLostError } from "@/lib/jobs/queue";
import { matchItem, type MatchSource } from "@/lib/match/matcher";
import { reconcileRuntimeMatches } from "@/lib/match/rematch";
import { loadOrgStacks } from "@/lib/match/stack";
import { sendRuntimeUrgent } from "@/pipeline/runtime-urgent";
import { ruleTriageRows, runtimeMetaFor } from "@/pipeline/runtime-urgent-plan";
import type { JobContext, JobResult } from "@/worker/types";

import { reconcileAdvisories } from "./advisory-reconcile";
import {
  isAnnouncementSource,
  reconcileAnnouncements,
  refreshOpenAnnouncements,
  type AnnouncementResult,
} from "./announcement-reconcile";
import { syncCuratedSources, syncServices } from "./catalog";
import { fetchSource } from "./fetch-source";

const CONCURRENCY = 6;
const FETCHABLE_KINDS = ["rss", "github_releases", "changelog_md", "github_advisories"] as const;

const MAY_BE_EMPTY: ReadonlySet<string> = new Set(["github_releases", "github_advisories"]);

/** Non-security sources are fetched every 6 hours; the slack absorbs the run's own duration. */
export const NON_SECURITY_INTERVAL_MS = 6 * 3_600_000;
const DUE_SLACK_MS = 10 * 60_000;

/**
 * Scheduled runs are hourly: `security` sources are fetched every run, the rest
 * once their last fetch is about 6 hours old. Manual runs (no `due` payload) fetch all.
 */
export function isSourceDue(
  source: { class: string; lastFetchedAt: Date | null },
  now: Date
): boolean {
  if (source.class === "security" || !source.lastFetchedAt) return true;
  return now.getTime() - source.lastFetchedAt.getTime() >= NON_SECURITY_INTERVAL_MS - DUE_SLACK_MS;
}

/** Payload of the scheduled collect-sources job. */
export function onlyDueSources(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    (payload as Record<string, unknown>).due === true
  );
}

/**
 * The org a scan-triggered run reconciles and delivers for (payload
 * `{ due: true, rematchOrgId }`, enqueued by /api/scan once the scan is complete).
 */
export function rematchOrgOf(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>).rematchOrgId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

interface NewItem {
  id: string;
  title: string;
  rawText: string;
  source: MatchSource;
}

/** collect-sources: fetch every enabled feed, store new items, match them to orgs. */
export async function collectSources({
  db,
  log,
  payload,
  heartbeat,
}: JobContext): Promise<JobResult> {
  const serviceIds = await syncServices(db);
  await syncCuratedSources(db, serviceIds);
  const now = new Date();

  const enabled = await db.source.findMany({
    where: { enabled: true, kind: { in: [...FETCHABLE_KINDS] } },
    include: { service: { select: { key: true } } },
    orderBy: { lastFetchedAt: { sort: "asc", nulls: "first" } },
  });
  const dueOnly = onlyDueSources(payload);
  const sources = dueOnly ? enabled.filter((s) => isSourceDue(s, now)) : enabled;

  const counts = {
    sources: sources.length,
    notDue: enabled.length - sources.length,
    runtimeSecurityItems: 0,
    ruleSecurity: 0,
    advisoriesUpdated: 0,
    advisoriesEscalated: 0,
    announcementsUpdated: 0,
    announcementFixes: 0,
    postBodyFetches: 0,
    rematchCreated: 0,
    rematchUpdated: 0,
    rematchErrors: 0,
    ok: 0,
    notModified: 0,
    errors: 0,
    itemsSeen: 0,
    itemsNew: 0,
    matches: 0,
  };
  const newItems: NewItem[] = [];
  const addAnnouncements = (r: AnnouncementResult) => {
    counts.announcementsUpdated += r.updated;
    counts.announcementFixes += r.fixReleased;
    counts.postBodyFetches += r.bodyFetches;
  };

  await mapLimit(sources, CONCURRENCY, async (source) => {
    const fetched = await fetchSource(source);
    const fetchedAt = new Date();
    // Curated feeds always have entries; zero means the parser no longer understands them.
    // Release feeds and advisory lists can legitimately be empty.
    const outcome =
      fetched.status === "ok" && fetched.items.length === 0 && !MAY_BE_EMPTY.has(source.kind)
        ? {
            status: "error" as const,
            httpStatus: fetched.httpStatus,
            error: "no items after parse",
          }
        : fetched;

    if (outcome.status === "error") {
      counts.errors++;
      log.warn({ url: source.url, error: outcome.error }, "collect: source failed");
      await db.source.update({
        where: { id: source.id },
        data: {
          lastFetchedAt: fetchedAt,
          lastStatus: outcome.httpStatus,
          lastError: outcome.error.slice(0, 1000),
        },
      });
      return;
    }
    if (outcome.status === "not_modified") {
      counts.notModified++;
      if (isAnnouncementSource(source)) {
        addAnnouncements(await refreshOpenAnnouncements(db, source.id, fetchedAt));
      }
      await db.source.update({
        where: { id: source.id },
        data: { lastFetchedAt: fetchedAt, lastStatus: 304, lastError: null },
      });
      return;
    }

    counts.ok++;
    counts.itemsSeen += outcome.items.length;
    let unique = [...new Map(outcome.items.map((i) => [i.contentHash, i])).values()];
    if (source.kind === "github_advisories") {
      // One item per GHSA id: edited advisories are updated in place, not added again.
      const reconciled = await reconcileAdvisories(db, source.id, unique);
      unique = reconciled.fresh;
      counts.advisoriesUpdated += reconciled.updated;
      counts.advisoriesEscalated += reconciled.escalated;
    } else if (isAnnouncementSource(source)) {
      const reconciled = await reconcileAnnouncements(db, source.id, unique, fetchedAt);
      unique = reconciled.fresh;
      addAnnouncements(reconciled);
      addAnnouncements(await refreshOpenAnnouncements(db, source.id, fetchedAt));
    }
    const created =
      unique.length === 0
        ? []
        : await db.item.createManyAndReturn({
            data: unique.map((item) => {
              const metadata = runtimeMetaFor(source, item);
              return {
                ...item,
                sourceId: source.id,
                metadata: metadata ? (metadata as Prisma.InputJsonValue) : undefined,
              };
            }),
            skipDuplicates: true,
            select: {
              id: true,
              title: true,
              rawText: true,
              metadata: true,
              publishedAt: true,
              createdAt: true,
            },
          });
    counts.itemsNew += created.length;
    // Runtime security items never wait for the LLM: a rule row files them as security.
    const security = created.filter((c) => c.metadata !== null);
    counts.runtimeSecurityItems += security.length;
    const ruleRows = ruleTriageRows(security, fetchedAt);
    if (ruleRows.length > 0) {
      const res = await db.itemTriage.createMany({ data: ruleRows, skipDuplicates: true });
      counts.ruleSecurity += res.count;
    }
    const matchSource: MatchSource = {
      kind: source.kind,
      url: source.url,
      serviceKey: source.service?.key ?? null,
      traits: source.keywords,
      runtime: source.runtime,
    };
    for (const item of created) {
      newItems.push({ id: item.id, title: item.title, rawText: item.rawText, source: matchSource });
    }

    await db.source.update({
      where: { id: source.id },
      data: {
        lastFetchedAt: fetchedAt,
        lastStatus: outcome.httpStatus,
        lastError: null,
        etag: outcome.etag,
        lastModified: outcome.lastModified,
      },
    });
  });

  if (sources.length > 0 && counts.errors === sources.length) {
    throw new Error(`all ${sources.length} sources failed`);
  }

  if (newItems.length > 0) {
    const stacks = await loadOrgStacks(db);
    for (const stack of stacks) {
      const rows = newItems.flatMap((item) => {
        const match = matchItem(item, item.source, stack);
        if (!match) return [];
        return [
          {
            orgId: stack.orgId,
            itemId: item.id,
            packageId: match.packageId,
            serviceId: match.serviceKey ? (serviceIds.get(match.serviceKey) ?? null) : null,
            repoIds: match.repoIds,
            reason: match.reason,
            score: match.score,
          },
        ];
      });
      if (rows.length > 0) {
        const res = await withOrg(db, stack.orgId).itemMatch.createMany({
          data: rows,
          skipDuplicates: true,
        });
        counts.matches += res.count;
      }
    }
  }

  // Before every urgent pass, the matches of open runtime security items are reconciled with
  // the orgs' included repos (the scanned org for a scan-triggered run, else every org), so a
  // repo whose runtime rows arrived after the first email still gets its follow-up.
  const rematchOrgId = rematchOrgOf(payload);
  const reconcileOrgIds = rematchOrgId
    ? [rematchOrgId]
    : (await db.org.findMany({ select: { id: true } })).map((o) => o.id);
  for (const orgId of reconcileOrgIds) {
    await heartbeat();
    try {
      const rematch = await reconcileRuntimeMatches(db, orgId, now);
      counts.rematchCreated += rematch.created;
      counts.rematchUpdated += rematch.updated;
    } catch (err) {
      counts.rematchErrors++;
      log.error({ err, orgId }, "collect: runtime match reconciliation failed");
    }
  }

  // Matches of this run and earlier pending ones (failed sends, repos included since).
  let urgent: Record<string, number> = {};
  try {
    // A scan-triggered run only delivers for the scanned org; the hourly run covers the rest.
    const scope = rematchOrgId ? { orgIds: [rematchOrgId] } : {};
    urgent = { ...(await sendRuntimeUrgent(db, log, now, heartbeat, scope)) };
  } catch (err) {
    // Another worker owns the job now; stop instead of finishing the run beside it.
    if (err instanceof JobLockLostError) throw err;
    urgent = { runtimeUrgentErrors: 1 };
    log.error({ err }, "collect: runtime urgent path failed");
  }

  // Triage follows every collect; it only picks up matched, untriaged items.
  await enqueueJob(db, "triage-items");

  log.info({ ...counts, ...urgent }, "collect: done");
  return { counts: { ...counts, ...urgent } };
}
