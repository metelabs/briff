import { renderUrgentEmail } from "@/lib/email/alert-email";
import { renderBulletinEmail } from "@/lib/email/bulletin-email";
import { PRODUCT_LANGUAGE, strings } from "@/lib/i18n";
import { matchItem, runtimesOf, type MatchSource, type OrgStack } from "@/lib/match/matcher";
import { RUNTIME_SECURITY_REASON, type RuntimeItemMeta } from "@/lib/runtime-security";
import {
  assembleBulletin,
  bulletinSubject,
  candidateFromMatch,
  countMinor,
  foldReleases,
  isoWeekLabel,
  itemUpgrades,
  RELEASE_KINDS,
  selectCandidates,
  subjectTopic,
  type Candidate,
  type SelectedCandidate,
} from "@/pipeline/bulletin";
import type { BulletinView, BulletinViewItem } from "@/pipeline/bulletin-model";
import type { RuntimeRow } from "@/pipeline/runtime-fixes";
import {
  RULE_TRIAGE_MAX_AGE_DAYS,
  RUNTIME_MATCH_LOOKBACK_MS,
  handledMatchUpdate,
  planRuntimeUrgent,
  ruleTriageRows,
  runtimeMetaFor,
  selectRuntimeWork,
  type StoredRuntimeMatch,
} from "@/pipeline/runtime-urgent-plan";
import { RULE_MODEL } from "@/pipeline/triage-rule";
import { ruleMinorReason } from "@/pipeline/versions";
import { parseWeights } from "@/pipeline/weights";
import { mergeRuntimes, parseRuntimeFile, runtimeFileKind, UNKNOWN_IMAGE } from "@scan/runtimes";
import { updatedAnnouncementMeta } from "@/sources/announcement-reconcile";
import { contentHash } from "@/sources/fetch-source";

import type {
  ReplayEmail,
  ReplayEntry,
  ReplayItem,
  ReplayRepo,
  ReplayResult,
  ReplayScenario,
  ReplaySource,
} from "./types";

// Replays the deterministic part of Briff over a scenario with a fake clock: no DB, no
// SMTP, no LLM. Each tick is one hourly collect-sources run: the items a source shows at
// that time are collected (runtime facts from the real extractors, rule triage rows),
// announcements edited in place are re-read, items are matched to the sample repos
// (`runtime:<id>`), and the urgent pass plans and renders its email with the real
// functions. A weekly tick runs selection and assembly for one stream with an empty
// model output, so act items carry the derived action and the item title (in production
// the model writes the headline and line; the action is the derived one either way).
// The state the DB would hold (items, triage rows, matches) lives in maps here.

const LANGUAGE = PRODUCT_LANGUAGE;
const WEEK_MS = 7 * 86_400_000;
const BULLETIN_BASE_URL = "https://app.briff.dev";

interface StoredItem {
  id: string;
  source: ReplaySource;
  title: string;
  url: string;
  contentHash: string;
  rawText: string;
  publishedAt: Date;
  createdAt: Date;
  visibleAt: Date;
  metadata: RuntimeItemMeta | undefined;
  /** When the update that brought the first fixed versions became visible. */
  fixVisibleAt?: Date;
}

interface StoredTriage {
  bucket: "security" | "minor";
  reason: string;
  model: string;
  createdAt: Date;
}

interface StoredMatch {
  itemId: string;
  repoIds: string[];
  reason: string;
  score: number;
  urgentAt: Date | null;
  urgentRepoIds: string[] | null;
  fixNotifiedAt: Date | null;
}

/** Runtime rows of the sample repos, from the real scanner parsers (repo id = repo name). */
export function repoRuntimeRows(repos: readonly ReplayRepo[]): (RuntimeRow & { repoId: string })[] {
  return repos.flatMap((repo) => {
    const detected = mergeRuntimes(
      Object.entries(repo.files).map(([path, content]) => {
        const kind = runtimeFileKind(path.split("/").at(-1) ?? path);
        return kind ? parseRuntimeFile(kind, content, path) : [];
      })
    );
    return detected
      .filter((r) => r.name !== UNKNOWN_IMAGE)
      .map((r) => ({
        repo: repo.name,
        repoId: repo.name,
        name: r.name,
        version: r.version,
        normalized: r.normalized,
        source: r.source,
        unresolved: r.unresolved,
        image: r.image ?? null,
      }));
  });
}

function visibleAt(item: ReplayItem): Date {
  return item.visibleAt ?? item.publishedAt;
}

/** The post as the source shows it at `now`: its last in-place edit before then. */
function bodyAt(item: ReplayItem, now: Date): { body: string; at: Date } {
  const edits = (item.updates ?? [])
    .filter((u) => u.at.getTime() < now.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const last = edits.at(-1);
  return last ? { body: last.body, at: last.at } : { body: item.body, at: visibleAt(item) };
}

function minutesBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 60_000);
}

/** Lines of a rendered urgent email that start with `label: `, without the text part's indent. */
function labelledLines(text: string, label: string): string[] {
  const prefix = `${label}: `;
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith(prefix));
}

export function runReplay(scenario: ReplayScenario): ReplayResult {
  const sources = new Map(scenario.sources.map((s) => [s.name, s]));
  const rows = repoRuntimeRows(scenario.repos);
  const includedRepos = new Map(scenario.repos.map((r) => [r.name, r.name]));
  const stack: OrgStack = {
    orgId: "replay",
    packages: new Map(),
    packagesByFeed: new Map(),
    services: new Map(),
    runtimes: runtimesOf(rows),
    traits: new Set(),
  };

  const items = new Map<string, StoredItem>();
  const triage = new Map<string, StoredTriage>();
  const matches = new Map<string, StoredMatch>();
  const untriaged = new Set<string>();
  const entries: ReplayEntry[] = scenario.world.map((worldEvent) => ({
    at: worldEvent.at,
    worldEvent,
  }));
  const lastWeekly = new Map<string, Date>();

  const ticks = [
    ...scenario.clock.map((at) => ({ at, kind: "collect" as const })),
    ...(scenario.weekly ?? []).map((w) => ({
      at: w.at,
      kind: "weekly" as const,
      stream: w.stream,
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime() || (a.kind === "weekly" ? 1 : -1));

  for (const tick of ticks) {
    const now = tick.at;
    if (tick.kind === "weekly") {
      const email = weeklyEmail(tick.stream, now, lastWeekly.get(tick.stream));
      lastWeekly.set(tick.stream, now);
      if (email) entries.push({ at: now, briffEmail: email });
      continue;
    }
    collect(now);
    const email = urgentPass(now);
    if (email) entries.push({ at: now, briffEmail: email });
  }

  function collect(now: Date): void {
    const fresh: StoredItem[] = [];
    for (const item of scenario.items) {
      if (visibleAt(item).getTime() >= now.getTime()) continue;
      const source = sources.get(item.source);
      if (!source) throw new Error(`replay: unknown source ${item.source}`);
      const hash = contentHash(item.url, item.title);
      const current = bodyAt(item, now);
      const stored = items.get(hash);
      if (stored) {
        refreshAnnouncement(stored, current, now);
        continue;
      }
      const metadata = runtimeMetaFor(source, {
        title: item.title,
        rawText: current.body,
        metadata: item.metadata,
      });
      const created: StoredItem = {
        id: hash.slice(0, 16),
        source,
        title: item.title,
        url: item.url,
        contentHash: hash,
        rawText: current.body,
        publishedAt: item.publishedAt,
        createdAt: now,
        visibleAt: current.at,
        metadata,
      };
      items.set(hash, created);
      fresh.push(created);
    }
    const security = fresh.filter((i) => i.metadata !== undefined);
    for (const row of ruleTriageRows(security, now)) {
      triage.set(row.itemId, {
        bucket: row.bucket,
        reason: row.reason,
        model: row.model,
        createdAt: now,
      });
    }
    for (const item of fresh) {
      const source: MatchSource = {
        kind: item.source.kind,
        url: item.source.url,
        serviceKey: null,
        traits: [],
        runtime: item.source.runtime,
      };
      const match = matchItem({ title: item.title, rawText: item.rawText }, source, stack);
      if (!match) continue;
      matches.set(item.id, {
        itemId: item.id,
        repoIds: match.repoIds,
        reason: match.reason,
        score: match.score,
        urgentAt: null,
        urgentRepoIds: null,
        fixNotifiedAt: null,
      });
      // triage-items follows every collect; without the LLM only its rule rows exist.
      if (!triage.has(item.id)) {
        const minor = ruleMinorReason(item.title);
        if (minor) {
          triage.set(item.id, {
            bucket: "minor",
            reason: minor,
            model: RULE_MODEL,
            createdAt: now,
          });
        } else if (
          now.getTime() - item.publishedAt.getTime() <=
          RULE_TRIAGE_MAX_AGE_DAYS * 86_400_000
        ) {
          untriaged.add(item.title);
        }
      }
    }
  }

  /** A stored announcement whose post changed: text and facts re-extracted, as in production. */
  function refreshAnnouncement(
    stored: StoredItem,
    current: { body: string; at: Date },
    now: Date
  ): void {
    if (current.body === stored.rawText) return;
    if (!stored.metadata || stored.metadata.kind !== "announcement") return;
    const { meta, fixAdded } = updatedAnnouncementMeta(
      stored.metadata,
      stored.title,
      current.body,
      now
    );
    stored.rawText = current.body;
    stored.metadata = meta;
    if (fixAdded) stored.fixVisibleAt = current.at;
  }

  function urgentPass(now: Date): ReplayEmail | null {
    const since = now.getTime() - RUNTIME_MATCH_LOOKBACK_MS;
    const byItemId = new Map([...items.values()].map((i) => [i.id, i]));
    const stored: StoredRuntimeMatch[] = [...matches.values()].flatMap((m) => {
      const item = byItemId.get(m.itemId);
      const t = triage.get(m.itemId);
      if (!item || !item.source.runtime || !m.reason.includes("runtime:")) return [];
      if (!t || t.reason !== RUNTIME_SECURITY_REASON || t.model !== RULE_MODEL) return [];
      if (item.publishedAt.getTime() < since) return [];
      return [
        {
          matchId: m.itemId,
          repoIds: m.repoIds,
          title: item.title,
          url: item.url,
          sourceName: item.source.name,
          runtime: item.source.runtime,
          metadata: item.metadata ?? null,
          publishedAt: item.publishedAt,
          contentHash: item.contentHash,
          createdAt: item.createdAt,
          urgentAt: m.urgentAt,
          urgentRepoIds: m.urgentRepoIds,
          fixNotifiedAt: m.fixNotifiedAt,
        },
      ];
    });
    const byId = new Map(stored.map((m) => [m.matchId, m]));
    const pending = selectRuntimeWork(stored, now);
    if (pending.length === 0) return null;
    const runtimes = new Set(pending.map((p) => p.runtime));
    const plan = planRuntimeUrgent(
      pending,
      includedRepos,
      rows.filter((r) => runtimes.has(r.name)),
      now
    );
    const kindOf = new Map(pending.map((p) => [p.matchId, p.followUp?.kind ?? ("new" as const)]));
    const markHandled = (ids: readonly string[]) => {
      for (const id of ids) {
        const m = byId.get(id);
        const match = matches.get(id);
        if (!m || !match) continue;
        const update = handledMatchUpdate(
          m,
          plan.covered[id] ?? [],
          kindOf.get(id) ?? "new",
          now,
          plan.fixCarried.includes(id)
        );
        match.urgentAt = update.urgentAt;
        match.urgentRepoIds = update.urgentRepoIds;
        if (update.fixNotifiedAt) match.fixNotifiedAt = update.fixNotifiedAt;
      }
    };
    markHandled(plan.skip);
    if (plan.items.length === 0) return null;
    const email = renderUrgentEmail(LANGUAGE, plan.items, BULLETIN_BASE_URL);
    // SMTP always succeeds in a replay: the email reached a member.
    markHandled(plan.send);
    const trigger = urgentTrigger(plan.send, kindOf, byItemId);
    return {
      kind: "urgent",
      at: now,
      subject: email.subject,
      html: email.html,
      text: email.text,
      trigger,
      delayMinutes: trigger ? minutesBetween(trigger.at, now) : null,
      items: plan.items.map((i) => i.title),
      todo: labelledLines(email.text, strings(LANGUAGE).todo),
      sources: labelledLines(email.text, strings(LANGUAGE).sources),
      view: null,
    };
  }

  function urgentTrigger(
    sent: readonly string[],
    kindOf: ReadonlyMap<string, string>,
    byItemId: ReadonlyMap<string, StoredItem>
  ): { at: Date; title: string } | null {
    const facts = sent.flatMap((id) => {
      const item = byItemId.get(id);
      if (!item) return [];
      const at = kindOf.get(id) === "fix" && item.fixVisibleAt ? item.fixVisibleAt : item.visibleAt;
      return [{ at, title: item.title }];
    });
    return facts.sort((a, b) => a.at.getTime() - b.at.getTime())[0] ?? null;
  }

  function weeklyEmail(stream: string, now: Date, previous: Date | undefined): ReplayEmail | null {
    const periodStart = previous ?? new Date(now.getTime() - WEEK_MS);
    const byItemId = new Map([...items.values()].map((i) => [i.id, i]));
    const candidates: Candidate[] = [...matches.values()].flatMap((m) => {
      const item = byItemId.get(m.itemId);
      const t = triage.get(m.itemId);
      if (!item || !t) return [];
      if (t.createdAt.getTime() < periodStart.getTime() || t.createdAt.getTime() >= now.getTime())
        return [];
      const c = candidateFromMatch({
        score: m.score,
        reason: m.reason,
        repoIds: m.repoIds,
        packageName: null,
        serviceKey: null,
        item: {
          id: item.id,
          contentHash: item.contentHash,
          title: item.title,
          url: item.url,
          rawText: item.rawText,
          publishedAt: item.publishedAt,
          metadata: item.metadata ?? null,
          sourceName: item.source.name,
          sourceKind: item.source.kind,
          triage: { bucket: t.bucket, packages: [], dueAt: null, dueWhat: null },
        },
      });
      return c ? [c] : [];
    });
    const t = strings(LANGUAGE);
    const runtimes = new Map<string, (RuntimeRow & { repoId: string })[]>();
    for (const r of rows) runtimes.set(r.name, [...(runtimes.get(r.name) ?? []), r]);
    const folded = foldReleases(candidates);
    const selected = selectCandidates(folded, includedRepos, parseWeights(null), {
      now,
      alertFixes: new Map(),
      transitiveAction: t.act_transitive,
      traits: new Set(),
      runtimes,
    });
    if (selected.length === 0) return null;
    const minorCount = countMinor(folded, includedRepos, new Set());
    const assembled = assembleBulletin(
      { summary: "", act: [], know: [] },
      selected,
      () => t.act_fallback
    );
    const byCandidate = new Map(selected.map((c) => [c.itemId, c]));
    const week = isoWeekLabel(now);
    const subject = bulletinSubject(
      stream,
      week,
      assembled.items.flatMap((i) => {
        const c = byCandidate.get(i.itemId);
        return i.section === "act" && c ? [subjectTopic(c, i.headline)] : [];
      })
    );
    const viewItem = (d: (typeof assembled.items)[number]): BulletinViewItem => {
      const item = byItemId.get(d.itemId) as StoredItem;
      return {
        itemId: d.itemId,
        bucket: d.bucket,
        headline: d.headline || item.title,
        line: d.line,
        action: d.action,
        todo: d.todo,
        title: item.title,
        url: item.url,
        sourceName: item.source.name,
        affectedRepos: d.affectedRepos,
        dueAt: null,
        folded: d.foldedItemIds.flatMap((id) => {
          const f = byItemId.get(id);
          return f
            ? [{ title: f.title, url: f.url, release: RELEASE_KINDS.has(f.source.kind) }]
            : [];
        }),
        upgrades: itemUpgrades(d, byCandidate.get(d.itemId) as SelectedCandidate, []),
      };
    };
    const inSection = (s: string) => assembled.items.filter((i) => i.section === s).map(viewItem);
    const view: BulletinView = {
      id: `replay-${scenario.id}`,
      orgId: "replay",
      weekLabel: week,
      streamId: "replay",
      streamName: stream,
      language: LANGUAGE,
      subject,
      summary: assembled.summary,
      minorCount,
      model: "none",
      promptVersion: "none",
      createdAt: now,
      emailStatus: "sent",
      emailSentAt: now,
      preview: false,
      previewModel: null,
      act: inSection("act"),
      know: inSection("know"),
      rest: inSection("rest"),
      alerts: [],
      backlogAlerts: [],
    };
    const email = renderBulletinEmail(view, { baseUrl: BULLETIN_BASE_URL, token: "replay" });
    return {
      kind: "weekly",
      at: now,
      subject: email.subject,
      html: email.html,
      text: email.text,
      trigger: null,
      delayMinutes: null,
      items: view.act.map((i) => i.title),
      todo: view.act.map((i) => i.action),
      sources: [],
      view,
    };
  }

  entries.sort(
    (a, b) =>
      a.at.getTime() - b.at.getTime() ||
      Number(Boolean(a.briffEmail)) - Number(Boolean(b.briffEmail))
  );
  return { scenario, entries, untriaged: [...untriaged] };
}
