import "server-only";

import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { plural } from "@/lib/format";
import { loadDrift } from "@/lib/stack-load";
import type { StreamScope } from "@/lib/stream-scope";
import { isoWeekLabel, weekStartOf } from "@/pipeline/bulletin";
import { sectionOf } from "@/pipeline/bulletin-view";
import {
  attentionSeries,
  burstsOf,
  foldBursts,
  isFollowUpScan,
  isStale,
  lastWeeks,
  mergeActivity,
  nextBulletinAt,
  openAlerts,
  stackHealth,
  weeklyAttention,
  type Activity,
} from "@/pipeline/home";

// Everything the home page shows, loaded through withOrg. Alerts and stack follow the stream
// scope (like Alerts and Stack); bulletins, the trend, repos and activity cover the whole org.

interface Counts {
  act: number;
  securityAct: number;
  know: number;
}

const NO_COUNTS: Counts = { act: 0, securityAct: 0, know: 0 };

export interface HomeTopItem {
  section: "act" | "know";
  security: boolean;
  text: string;
}

export interface HomeStream {
  id: string;
  name: string;
  repoCount: number;
  latest: {
    id: string;
    weekStart: Date;
    emailSentAt: Date | null;
    counts: Counts;
    top: HomeTopItem[];
    current: boolean;
  } | null;
  series: (number | null)[];
}

export type HomeData = Awaited<ReturnType<typeof loadHome>>;

export async function loadHome(orgId: string, scope: StreamScope, now: Date) {
  const weeks = lastWeeks(now);
  const thisWeek = weekStartOf(now);
  const since = weeks[0];
  const db = withOrg(getDb(), orgId);

  const [streams, bulletins, alertRows, repos, { drift }, activity] = await Promise.all([
    db.bulletinStream.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, _count: { select: { repos: true } } },
    }),
    // At most one bulletin per stream and week, so the 12 weeks stay small.
    db.bulletin.findMany({
      where: { preview: false, weekStart: { gte: since } },
      orderBy: [{ weekStart: "desc" }, { createdAt: "desc" }],
      select: { id: true, streamId: true, weekStart: true },
    }),
    // Open alerts, plus what was resolved or raised inside the 12 weeks (trend and delta).
    db.alert.findMany({
      where: {
        repo: { included: true },
        OR: [{ resolvedAt: null }, { resolvedAt: { gte: since } }, { createdAt: { gte: since } }],
      },
      select: {
        advisoryId: true,
        kind: true,
        createdAt: true,
        reviewedAt: true,
        resolvedAt: true,
        advisory: { select: { severity: true } },
        repo: { select: { streams: { select: { streamId: true } } } },
      },
    }),
    db.repo.findMany({
      orderBy: { name: "asc" },
      select: { name: true, included: true, lastScannedAt: true },
    }),
    loadDrift(orgId, scope),
    loadActivity(orgId),
  ]);

  const latestRows = (
    await Promise.all(
      streams.map((st) =>
        db.bulletin.findFirst({
          where: { preview: false, streamId: st.id },
          orderBy: [{ weekStart: "desc" }, { createdAt: "desc" }],
          select: { id: true, streamId: true, weekStart: true, emailSentAt: true },
        })
      )
    )
  ).flatMap((b) => (b ? [b] : []));
  const latestIds = latestRows.map((b) => b.id);
  const countedIds = [...new Set([...bulletins.map((b) => b.id), ...latestIds])];
  const [groups, items] =
    countedIds.length > 0
      ? await Promise.all([
          db.bulletinItem.groupBy({
            by: ["bulletinId", "section", "bucket"],
            where: { bulletinId: { in: countedIds } },
            _count: { _all: true },
          }),
          db.bulletinItem.findMany({
            where: { bulletinId: { in: latestIds }, bucket: { not: "minor" } },
            orderBy: { order: "asc" },
            select: { bulletinId: true, section: true, bucket: true, headline: true, line: true },
          }),
        ])
      : [[], []];

  const counts = new Map<string, Counts>();
  for (const row of groups) {
    const c = counts.get(row.bulletinId) ?? { ...NO_COUNTS };
    const section = sectionOf(row.section, row.bucket);
    if (section === "act") c.act += row._count._all;
    if (section === "know") c.know += row._count._all;
    if (section === "act" && row.bucket === "security") c.securityAct += row._count._all;
    counts.set(row.bulletinId, c);
  }
  const countsOf = (id: string): Counts => counts.get(id) ?? NO_COUNTS;

  const topOf = (bulletinId: string): HomeTopItem[] =>
    items
      .filter((i) => i.bulletinId === bulletinId)
      .flatMap((i) => {
        const section = sectionOf(i.section, i.bucket);
        if (section === "rest") return [];
        return [{ section, security: i.bucket === "security", text: i.headline || i.line }];
      })
      // act before know; within each, the bulletin's own order
      .sort((a, b) => (a.section === b.section ? 0 : a.section === "act" ? -1 : 1))
      .slice(0, 3);

  const homeStreams: HomeStream[] = streams.map((s) => {
    const last = latestRows.find((b) => b.streamId === s.id) ?? null;
    return {
      id: s.id,
      name: s.name,
      repoCount: s._count.repos,
      latest: last && {
        id: last.id,
        weekStart: last.weekStart,
        emailSentAt: last.emailSentAt,
        counts: countsOf(last.id),
        top: topOf(last.id),
        current: last.weekStart.getTime() === thisWeek.getTime(),
      },
      series: attentionSeries(
        weeks,
        bulletins
          .filter((b) => b.streamId === s.id)
          .map((b) => ({ weekStart: b.weekStart, act: countsOf(b.id).act }))
      ),
    };
  });

  const alertStates = alertRows.map((a) => ({
    advisoryId: a.advisoryId,
    severity: a.advisory.severity,
    kind: a.kind,
    createdAt: a.createdAt,
    reviewedAt: a.reviewedAt,
    resolvedAt: a.resolvedAt,
    streamIds: a.repo.streams.map((s) => s.streamId),
  }));
  // Same rows as repoScope(scope): the picked stream's repos, or every included repo.
  const scoped = scope.current
    ? alertStates.filter((a) => a.streamIds.includes(scope.current?.id ?? ""))
    : alertStates;
  const open = openAlerts(scoped, now);
  const backlogOpen = new Set(
    scoped
      .filter((a) => a.kind === "backlog" && a.resolvedAt === null && a.reviewedAt === null)
      .map((a) => a.advisoryId)
  ).size;
  const resolvedThisWeek = scoped.filter(
    (a) => a.resolvedAt !== null && a.resolvedAt >= thisWeek
  ).length;

  const trend = weeklyAttention(
    weeks,
    bulletins.map((b) => ({ weekStart: b.weekStart, ...countsOf(b.id) })),
    alertStates
  );

  const stale = repos.filter((r) => isStale(r.lastScannedAt, now));
  const lastScan = repos.reduce<Date | null>(
    (latest, r) =>
      r.lastScannedAt && (!latest || r.lastScannedAt > latest) ? r.lastScannedAt : latest,
    null
  );
  const lastBulletin = latestRows.reduce<(typeof latestRows)[number] | null>(
    (latest, b) => (!latest || b.weekStart > latest.weekStart ? b : latest),
    null
  );

  return {
    weeks,
    streams: homeStreams,
    trend,
    alerts: { ...open, backlogOpen, resolvedThisWeek },
    repos: {
      total: repos.length,
      stale: stale.map((r) => r.name),
      unlinked: repos.filter((r) => !r.included).map((r) => r.name),
      lastScan,
    },
    stack: {
      repos: drift.length,
      health: stackHealth(drift),
      eol: drift.filter((r) => r.eol).map((r) => r.repo),
    },
    nextBulletin: nextBulletinAt(now),
    lastBulletin,
    activity,
  };
}

const SCAN_FOLD_MS = 60 * 60_000;
const ACTIVITY_LIMIT = 10;

function names(list: readonly string[], shown = 2): string {
  const unique = [...new Set(list)];
  const head = unique.slice(0, shown).join(", ");
  return unique.length > shown ? `${head} and ${unique.length - shown} more` : head;
}

/**
 * The org's last events from the tables that carry a timestamp. A scan is a repo's last
 * one only (`Repo.lastScannedAt`): uploads are not kept, so older scans have no row.
 * Folded sources are never cut by a row limit, so a burst is counted in full before the last
 * ten are picked: repos are read whole, and resolutions as their distinct pass times first
 * (one scan resolves its alerts with one timestamp), then the rows of the newest ten bursts.
 */
async function loadActivity(orgId: string): Promise<Activity[]> {
  const db = withOrg(getDb(), orgId);
  const [resolved, sent, repos, members] = await Promise.all([
    loadResolutions(orgId),
    db.bulletin.findMany({
      where: { preview: false, emailSentAt: { not: null } },
      orderBy: { emailSentAt: "desc" },
      take: 10,
      select: { id: true, emailSentAt: true, weekStart: true, stream: { select: { name: true } } },
    }),
    db.repo.findMany({ select: { id: true, name: true, firstSeenAt: true, lastScannedAt: true } }),
    db.orgEvent.findMany({
      where: { type: { in: ["invite_accepted", "org_created"] } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        type: true,
        createdAt: true,
        targetEmail: true,
        detail: true,
        actor: { select: { name: true, email: true } },
      },
    }),
  ]);

  const resolvedEvents = foldBursts(
    resolved.flatMap((a) =>
      a.resolvedAt
        ? [{ at: a.resolvedAt, key: `r:${a.id}`, pkg: a.advisory.package.name, repo: a.repo.name }]
        : []
    ),
    (g) =>
      g.length === 1
        ? `${g[0].pkg} advisory resolved in ${g[0].repo}`
        : `${plural(g.length, "alert")} resolved (${names(g.map((e) => e.pkg))}) in ${names(g.map((e) => e.repo))}`
  ).map((e): Activity => ({
    kind: "alert_resolved",
    at: e.at,
    key: e.key,
    text: e.text,
    href: "/alerts",
  }));

  const sentEvents = sent.flatMap((b): Activity[] =>
    b.emailSentAt
      ? [
          {
            kind: "bulletin_sent",
            at: b.emailSentAt,
            key: `b:${b.id}`,
            text: `${b.stream?.name ?? "Deleted stream"} bulletin ${isoWeekLabel(b.weekStart).slice(5)} sent`,
            href: `/b/${b.id}`,
          },
        ]
      : []
  );

  const addedEvents = foldBursts(
    repos.map((r) => ({ at: r.firstSeenAt, key: `a:${r.id}`, name: r.name })),
    (g) =>
      g.length === 1
        ? `${g[0].name} added`
        : `${plural(g.length, "repo")} added: ${names(g.map((e) => e.name))}`
  ).map((e): Activity => ({
    kind: "repo_added",
    at: e.at,
    key: e.key,
    text: e.text,
    href: "/repos",
  }));

  const scanEvents = foldBursts(
    repos.flatMap((r) =>
      r.lastScannedAt && isFollowUpScan(r.firstSeenAt, r.lastScannedAt)
        ? [{ at: r.lastScannedAt, key: `s:${r.id}`, name: r.name }]
        : []
    ),
    (g) =>
      g.length === 1
        ? `Scan received for ${g[0].name}`
        : `Scan received for ${plural(g.length, "repo")}: ${names(g.map((e) => e.name))}`,
    // Scheduled scans (the nightly scanner, a GitHub App sweep) upload repo by repo.
    SCAN_FOLD_MS
  ).map((e): Activity => ({ kind: "scan", at: e.at, key: e.key, text: e.text, href: "/stack" }));

  const memberEvents = members.map((e): Activity => ({
    kind: "member",
    at: e.createdAt,
    key: `m:${e.id}`,
    text:
      e.type === "org_created"
        ? `${e.actor?.name || e.actor?.email || "Someone"} created the organisation`
        : `${e.targetEmail ?? e.actor?.email ?? "A member"} joined${e.detail ? ` as ${e.detail}` : ""}`,
    href: "/settings#members",
  }));

  return mergeActivity(
    [resolvedEvents, sentEvents, addedEvents, scanEvents, memberEvents],
    ACTIVITY_LIMIT
  );
}

async function loadResolutions(orgId: string) {
  const db = withOrg(getDb(), orgId);
  const passes = await db.alert.groupBy({
    by: ["resolvedAt"],
    where: { resolvedAt: { not: null } },
  });
  const newest = burstsOf(
    passes.flatMap((p) =>
      p.resolvedAt ? [{ at: p.resolvedAt, key: p.resolvedAt.toISOString() }] : []
    )
  )
    .slice(0, ACTIVITY_LIMIT)
    .flat()
    .map((p) => p.at);
  if (newest.length === 0) return [];
  return db.alert.findMany({
    where: { resolvedAt: { in: newest } },
    select: {
      id: true,
      resolvedAt: true,
      repo: { select: { name: true } },
      advisory: { select: { package: { select: { name: true } } } },
    },
  });
}
