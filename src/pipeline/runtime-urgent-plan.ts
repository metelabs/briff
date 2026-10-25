import type { UrgentItem } from "@/lib/email/alert-email";
import {
  groupIncidents,
  incidentPrimary,
  incidentSourceOrder,
  mergeIncidentMeta,
  type IncidentFacts,
} from "@/lib/runtime-incident";
import {
  RUNTIME_SECURITY_REASON,
  emailsImmediately,
  isRuntimeSecurityText,
  parseRuntimeMeta,
  runtimeMetaFromText,
  releaseLineOf,
  runtimeItemWindow,
  runtimeName,
  RUNTIME_ITEM_LOOKBACK_MS,
  type RuntimeItemMeta,
} from "@/lib/runtime-security";

import {
  affectedRuntimeRepos,
  evidenceRows,
  describeRow,
  formatUtc,
  runtimeAction,
  runtimeRepoActions,
  runtimeRepoGaps,
  type RuntimeRow,
} from "./runtime-fixes";
import { RULE_MODEL, RULE_VERSION } from "./triage-rule";

// Deterministic urgent path (no LLM) for runtime security items: an item from a
// `security` source with a runtime that carries runtime facts (every GitHub
// advisory; feed posts that match isRuntimeSecurityText) gets a rule-based
// security triage row in collect-sources and is emailed in the same run to every
// org whose included repos declare the runtime. `ItemMatch.urgentAt` makes it
// once per (item, org); a failed or impossible send stays pending and is retried
// by the next hourly collect while the item is younger than URGENT_MAX_AGE_HOURS.
//
// Follow-ups, each at most once: `urgentRepoIds` records the repos an email covered,
// so repos the reconciliation (src/lib/match/rematch.ts) adds to a handled match get one
// "also affects" email listing only them; `fixNotifiedAt` marks the "fix is out" email of
// an announcement whose post gained fixed versions in place (`metadata.fixAddedAt`).
// Once the fixed versions are known, every email of the match carries them, so after
// `fixNotifiedAt` the repos of `urgentRepoIds` are exactly the repos told about the fix:
// an "also affects" email sent then is in the fix form (fixed versions, one action per repo).
//
// This module is the pure half, shared with the replay engine (no DB imports: the public
// replay pages reach it, src/test/public-routes.test.ts); runtime-urgent.ts loads and sends.

export { RUNTIME_SECURITY_REASON } from "@/lib/runtime-security";
export { URGENT_MAX_AGE_HOURS } from "@/lib/runtime-security";
/** Same window as LLM triage: older items can never enter a bulletin. */
export const RULE_TRIAGE_MAX_AGE_DAYS = 14;

export interface SecuritySourceRef {
  class: string;
  runtime: string | null;
  kind: string;
}

/**
 * Runtime facts for a new item of a source, or undefined when it is not a runtime
 * security item. Advisories bring their own; feed posts must match the pattern.
 */
export function runtimeMetaFor(
  source: SecuritySourceRef,
  item: { title: string; rawText: string; metadata?: RuntimeItemMeta }
): RuntimeItemMeta | undefined {
  if (source.class !== "security" || !source.runtime) return undefined;
  if (source.kind === "github_advisories") return item.metadata;
  return isRuntimeSecurityText(item.title, item.rawText)
    ? runtimeMetaFromText(item.title, item.rawText)
    : undefined;
}

function itemTime(item: { publishedAt: Date | null; createdAt: Date }): Date {
  return item.publishedAt ?? item.createdAt;
}

/** Rule rows for new runtime security items young enough for a bulletin. */
export function ruleTriageRows(
  items: readonly { id: string; publishedAt: Date | null; createdAt: Date }[],
  now: Date
): { itemId: string; bucket: "security"; reason: string; model: string; promptVersion: string }[] {
  const since = now.getTime() - RULE_TRIAGE_MAX_AGE_DAYS * 86_400_000;
  return items
    .filter((i) => itemTime(i).getTime() >= since)
    .map((i) => ({
      itemId: i.id,
      bucket: "security" as const,
      reason: RUNTIME_SECURITY_REASON,
      model: RULE_MODEL,
      promptVersion: RULE_VERSION,
    }));
}

/** A follow-up of a match that was already emailed (or handled without an email). */
export type RuntimeFollowUp =
  /**
   * `repoIds` are only the repos the first email did not cover. In the fix form (fixed
   * versions, one action per repo) once the item names fixed versions.
   */
  | { kind: "addition"; since: Date }
  /** The announcement now names fixed versions; `repoIds` are all the match's repos. */
  | { kind: "fix" };

export interface PendingRuntimeMatch {
  matchId: string;
  repoIds: string[];
  followUp?: RuntimeFollowUp;
  title: string;
  url: string;
  sourceName: string;
  runtime: string;
  metadata: unknown;
  publishedAt: Date | null;
  /** Item.contentHash: deterministic order of matches and incident sources. */
  contentHash: string;
}

export interface RuntimeUrgentPlan {
  items: UrgentItem[];
  /** Matches the email covers. */
  send: string[];
  /** Per sent or skipped match: the repo ids now handled (included repos of `repoIds`). */
  covered: Record<string, string[]>;
  /** Matches handled without an email: moderate severity, or no affected repo version. */
  skip: string[];
  /** Matches left pending: reached only through repos outside every stream. */
  wait: string[];
  /**
   * Matches folded into a block that names fixed versions: once it is sent they count as
   * told about the fix, whatever their own metadata says (handledMatchUpdate `carriedFix`).
   */
  fixCarried: string[];
}

interface PlannedMatch {
  p: PendingRuntimeMatch;
  meta: RuntimeItemMeta;
  visible: string[];
}

function incidentFacts(m: PlannedMatch): IncidentFacts {
  return {
    runtime: m.p.runtime,
    meta: m.meta,
    publishedAt: m.p.publishedAt,
    contentHash: m.p.contentHash,
  };
}

/**
 * Whether an item of an incident speaks to the org's repos: a single-line release post only
 * to repos on its own line that it affects, any other item to the repos it affects. The ones
 * that do are the block's sources; the rest (release posts of lines nobody runs, or of lines
 * already on the fix) are handled without a word.
 */
function concernsRepos(m: PlannedMatch, rows: readonly RuntimeRow[], asOf: Date): boolean {
  const { runtime } = m.p;
  if (m.meta.lineSpecific && m.meta.fixedVersions.length > 0) {
    const lines = new Set(m.meta.fixedVersions.map((v) => releaseLineOf(runtime, v)));
    // Evidence first: a range must not put a repo on a line its Dockerfile is not on.
    const onLine = evidenceRows(rows.filter((r) => r.name === runtime)).filter(
      (r) =>
        !r.unresolved && r.normalized !== null && lines.has(releaseLineOf(runtime, r.normalized))
    );
    return affectedRuntimeRepos(runtime, m.meta, onLine, asOf).length > 0;
  }
  return affectedRuntimeRepos(runtime, m.meta, rows, asOf).length > 0;
}

/** The block's follow-up: "fix" if any item's fix just landed, else new if any item is new. */
function incidentFollowUp(members: readonly PlannedMatch[]): RuntimeFollowUp | undefined {
  const kinds = members.map((m) => m.p.followUp);
  if (kinds.some((k) => k?.kind === "fix")) return { kind: "fix" };
  if (kinds.some((k) => k === undefined)) return undefined;
  const since = kinds.flatMap((k) => (k?.kind === "addition" ? [k.since] : []));
  return { kind: "addition", since: new Date(Math.min(...since.map((d) => d.getTime()))) };
}

function sourceLabel(m: PlannedMatch): string {
  return m.meta.kind === "advisory" && m.meta.ghsaId ? m.meta.ghsaId : m.p.title;
}

/**
 * Pure: which pending matches of one org go into its email. `includedRepos` maps
 * repo id -> name; `rows` are the runtime rows of those repos. Matches of one incident
 * (src/lib/runtime-incident.ts) fold into one block: the primary's title, merged facts,
 * one action per repo once fixed versions are known, and every folded item as a source.
 */
export function planRuntimeUrgent(
  pending: readonly PendingRuntimeMatch[],
  includedRepos: ReadonlyMap<string, string>,
  rows: readonly (RuntimeRow & { repoId: string })[],
  asOf: Date = new Date()
): RuntimeUrgentPlan {
  const plan: RuntimeUrgentPlan = {
    items: [],
    send: [],
    covered: {},
    skip: [],
    wait: [],
    fixCarried: [],
  };
  const ordered = [...pending].sort(
    (a, b) =>
      (a.publishedAt?.getTime() ?? 0) - (b.publishedAt?.getTime() ?? 0) ||
      a.contentHash.localeCompare(b.contentHash)
  );
  const planned: PlannedMatch[] = [];
  for (const p of ordered) {
    const visible = [...new Set(p.repoIds.filter((id) => includedRepos.has(id)))];
    if (visible.length === 0) {
      plan.wait.push(p.matchId);
      continue;
    }
    plan.covered[p.matchId] = visible;
    const meta = parseRuntimeMeta(p.metadata);
    if (!meta) {
      plan.skip.push(p.matchId);
      continue;
    }
    planned.push({ p, meta, visible });
  }

  for (const group of groupIncidents(planned, incidentFacts)) {
    const runtime = group[0].p.runtime;
    const skipAll = () => plan.skip.push(...group.map((m) => m.p.matchId));
    const groupPrimary = incidentPrimary(group, incidentFacts);
    const groupMeta = mergeIncidentMeta(
      runtime,
      groupPrimary.meta,
      group.map((m) => m.meta)
    );
    if (!emailsImmediately(groupMeta)) {
      skipAll();
      continue;
    }
    const visible = new Set(group.flatMap((m) => m.visible));
    const repoRows = rows.filter((r) => visible.has(r.repoId) && r.name === runtime);
    if (affectedRuntimeRepos(runtime, groupMeta, repoRows, asOf).length === 0) {
      skipAll();
      continue;
    }
    // A lone single-line post for a line nobody runs still speaks for an end-of-life line.
    const speaking = group.filter((m) => concernsRepos(m, repoRows, asOf));
    const sources = speaking.length > 0 ? speaking : group;
    plan.skip.push(...group.filter((m) => !sources.includes(m)).map((m) => m.p.matchId));

    const sourceList = incidentSourceOrder(sources, incidentFacts);
    const primary = sourceList[0];
    const meta = mergeIncidentMeta(
      runtime,
      primary.meta,
      sources.map((m) => m.meta)
    );
    const repoIds = new Set(sources.flatMap((m) => m.visible));
    const sourceRows = repoRows.filter((r) => repoIds.has(r.repoId));
    const affected = affectedRuntimeRepos(runtime, meta, sourceRows, asOf);
    const affectedNames = new Set(affected.map((a) => a.repo));
    const gaps = runtimeRepoGaps(
      runtime,
      meta,
      [...repoIds].map((id) => includedRepos.get(id) as string),
      sourceRows,
      asOf
    );
    const runs = new Map<string, string[]>();
    for (const r of sourceRows) {
      if (!affectedNames.has(r.repo)) continue;
      runs.set(r.repo, [...new Set([...(runs.get(r.repo) ?? []), describeRow(r)])]);
    }
    plan.send.push(...sourceList.map((m) => m.p.matchId));
    if (meta.fixedVersions.length > 0) plan.fixCarried.push(...sourceList.map((m) => m.p.matchId));
    const followUp = incidentFollowUp(sources);
    // Emails people act on (follow-ups, and any email that names the fix): one line per
    // repo, never shortened.
    const perRepo = followUp !== undefined || meta.fixedVersions.length > 0;
    plan.items.push({
      ...(followUp
        ? {
            followUp:
              followUp.kind === "addition"
                ? { kind: "addition" as const, since: formatUtc(followUp.since.toISOString()) }
                : { kind: "fix" as const },
          }
        : {}),
      title: primary.p.title,
      url: primary.p.url,
      bucket: "security",
      reason: RUNTIME_SECURITY_REASON,
      sourceName: primary.p.sourceName,
      affectedRepos: [...affectedNames].sort(),
      ...(sourceList.length > 1
        ? { sources: sourceList.map((m) => ({ label: sourceLabel(m), url: m.p.url })) }
        : {}),
      runtime: {
        name: runtimeName(runtime),
        repos: [...runs]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([repo, list]) => ({ repo, runs: list })),
        fixedVersions: meta.fixedVersions,
        scheduledFor: meta.scheduledAt ? formatUtc(meta.scheduledAt) : null,
        severity: meta.severity,
        cveIds: meta.cveIds,
        action: runtimeAction(runtime, meta, sourceRows, asOf),
        ...(perRepo ? { repoActions: runtimeRepoActions(runtime, meta, sourceRows, asOf) } : {}),
        ...(gaps.unaffected.length > 0 ? { unaffected: gaps.unaffected } : {}),
        ...(gaps.noVersion.length > 0 ? { noVersion: gaps.noVersion } : {}),
      },
    });
  }
  return plan;
}

/** A runtime security match of an org as stored, for selectRuntimeWork. */
export interface StoredRuntimeMatch extends Omit<PendingRuntimeMatch, "followUp"> {
  createdAt: Date;
  urgentAt: Date | null;
  /** Null on pending matches (and before the follow-up columns existed). */
  urgentRepoIds: string[] | null;
  fixNotifiedAt: Date | null;
}

/** Lookback for the query: a fix can land up to the triage window after the post. */
export const RUNTIME_MATCH_LOOKBACK_MS = RUNTIME_ITEM_LOOKBACK_MS;

/**
 * Pure: what the urgent pass does with each stored match. Pending matches of a young
 * item (or of an item whose fix just appeared) go out as they are. A handled match
 * goes out again only as a follow-up: "fix" once after the post gained fixed versions,
 * else "addition" for the repos its email did not cover. Everything else is left alone.
 */
export function selectRuntimeWork(
  matches: readonly StoredRuntimeMatch[],
  now: Date
): PendingRuntimeMatch[] {
  return matches.flatMap((m): PendingRuntimeMatch[] => {
    const { itemRecent, fixRecent } = runtimeItemWindow(m, parseRuntimeMeta(m.metadata), now);
    const base = {
      matchId: m.matchId,
      repoIds: m.repoIds,
      title: m.title,
      url: m.url,
      sourceName: m.sourceName,
      runtime: m.runtime,
      metadata: m.metadata,
      publishedAt: m.publishedAt,
      contentHash: m.contentHash,
    };
    if (!m.urgentAt) return itemRecent || fixRecent ? [base] : [];
    if (fixRecent && !m.fixNotifiedAt) return [{ ...base, followUp: { kind: "fix" } }];
    if (!itemRecent && !fixRecent) return [];
    // A handled match without the list (written before it existed) counts as fully covered.
    const covered = new Set(m.urgentRepoIds ?? m.repoIds);
    const uncovered = m.repoIds.filter((id) => !covered.has(id));
    if (uncovered.length === 0) return [];
    return [{ ...base, repoIds: uncovered, followUp: { kind: "addition", since: m.urgentAt } }];
  });
}

/**
 * Pure: the columns a sent or skipped match gets. `covered` is exactly the repos this run
 * planned with, so repos a rematch adds meanwhile stay uncovered and get their own
 * follow-up. `fixNotifiedAt` is set by the "fix is out" email, and by any email that
 * already carried the fixed versions, its own or those of an item folded with it.
 */
export function handledMatchUpdate(
  m: Pick<StoredRuntimeMatch, "urgentAt" | "urgentRepoIds" | "fixNotifiedAt" | "metadata">,
  covered: readonly string[],
  kind: "new" | RuntimeFollowUp["kind"],
  now: Date,
  /** The email's block named fixed versions (another item of the incident brought them). */
  carriedFix = false
): { urgentAt: Date; urgentRepoIds: string[]; fixNotifiedAt?: Date } {
  const hasFix = carriedFix || (parseRuntimeMeta(m.metadata)?.fixedVersions.length ?? 0) > 0;
  return {
    urgentAt: m.urgentAt ?? now,
    urgentRepoIds: [...new Set([...(m.urgentRepoIds ?? []), ...covered])],
    ...(kind === "fix" || (hasFix && !m.fixNotifiedAt) ? { fixNotifiedAt: now } : {}),
  };
}
