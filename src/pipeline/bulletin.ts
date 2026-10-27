import { z } from "zod";

import { sha256Hex } from "@/lib/crypto";
import { incidentPrimary, mergeIncidentMeta } from "@/lib/runtime-incident";
import { parseRuntimeMeta, runtimeName, type RuntimeItemMeta } from "@/lib/runtime-security";
import { serviceByKey } from "@/lib/services";
import { severityRank as advisoryRank } from "@/security/plan";
import { affectedInstalls, fixedVersionFor, type OsvRange } from "@/sources/osv";
import { asEcosystem, type Ecosystem, type PackageManager } from "@scan/ecosystems";

import type { Bucket } from "./buckets";
import { fixCommand, fixVersions, type RepoFix } from "./fixes";
import { whyCommand } from "./install-commands";
import {
  alignUpgrades,
  installTargets,
  packageUpgrades,
  releaseUpgrades,
  runtimeUpgrades,
  type RepoInstall,
  type RepoUpgrade,
} from "./upgrades";
import { affectedRuntimeRepos, runtimeAction, type RuntimeRow } from "./runtime-fixes";
import { compareVersions, extractVersion, ruleMinorReason } from "./versions";
import { EXCLUDE_AT, itemWeight, type ItemKeys, type Weights } from "./weights";

// Pure parts of the weekly synthesis (plan §7.6): candidate selection, the model
// input, validation of the model output against the input, and the input hash.

export const SYNTHESIS_MAX_ITEMS = 30;
const TEXT_CHARS = 700;
/** Security and deadline bodies carry the fix and the date; they keep more text. */
const PROTECTED_TEXT_CHARS = 1200;
const WEIGHT_FACTOR = 0.1;

/** Monday 00:00 UTC of the week containing `date`. */
export function weekStartOf(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d;
}

/** ISO 8601 week label, e.g. 2026-W42. */
export function isoWeekLabel(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // the week's Thursday decides the year
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export interface FoldedRelease {
  itemId: string;
  title: string;
  url: string;
}

export interface Candidate {
  itemId: string;
  contentHash: string;
  title: string;
  url: string;
  rawText: string;
  publishedAt: Date | null;
  sourceName: string;
  /** Source.kind: `rss`, `github_releases`, `changelog_md`. */
  sourceKind: string;
  bucket: Bucket;
  score: number;
  /** ItemMatch.reason, e.g. `release:next`, `service:expo+mention:expo-router`. */
  matchReason: string;
  /** Repo ids from ItemMatch; empty when the match was platform/service-wide. */
  repoIds: string[];
  keys: ItemKeys;
  dueAt: Date | null;
  dueWhat: string | null;
  /** Older releases of the same package folded into this one (see foldReleases). */
  folded: FoldedRelease[];
  /** Item.metadata of a runtime security item (fixed versions, severity); absent otherwise. */
  runtimeMeta?: RuntimeItemMeta | null;
  /**
   * The ItemMatch's package as (ecosystem, name): it tells apart an npm and a PyPI package of
   * one name when both have alerts. Absent for matches without a package.
   */
  matchedPackage?: { ecosystem: string; name: string } | null;
}

export interface SelectedCandidate extends Candidate {
  rank: number;
  affectedRepos: string[];
  /** Belongs in "do this week": affected installed version, or a deadline that is close. */
  mustAct: boolean;
  /** Deterministic action when one is known (fix version, deadline requirement). */
  suggestedAction: string | null;
  /** Versions the derived security command installs, newest first; the headline names only these. */
  fixVersions?: string[];
  /** Per repo: installed version -> the version the derived action moves it to (upgrades.ts). */
  upgrades?: RepoUpgrade[];
}

/** Signals for the act/know split that come from outside the item itself. */
export interface ActContext {
  now: Date;
  /** Package name -> per-repo installed version and resolved fix, from this period's OSV alerts. */
  alertFixes: ReadonlyMap<string, readonly RepoFix[]>;
  /**
   * Action for a package every affected repo has only transitively (no install command);
   * `why` is the ecosystem's command that shows what pulls it in (`npm ls x`, `composer why x`).
   */
  transitiveAction?: (pkg: string, why: string) => string;
  /**
   * Traits of the stream's repos (from their direct services). When given, a
   * platform-wide `trait:<t>` match is kept only if the stream has that trait;
   * `trait:always` feeds reach every stream.
   */
  traits?: ReadonlySet<string>;
  /** Runtime id -> the stream's RepoRuntime rows, for runtime security actions. */
  runtimes?: ReadonlyMap<string, readonly (RuntimeRow & { repoId: string })[]>;
  /**
   * Package name -> repo name -> installed versions in the stream's repos, for the packages
   * of `alertFixes`: an affected repo without an alert entry is listed with them.
   */
  alertInstalls?: ReadonlyMap<string, ReadonlyMap<string, readonly RepoInstall[]>>;
}

/** A deadline due within this many days lands in "do this week". */
export const ACT_DEADLINE_DAYS = 14;

/** Folding keeps the highest of these; minor never folds. */
const SEVERITY: Bucket[] = ["security", "deadline", "breaking_or_feature", "model_or_pricing"];

function severityRank(bucket: Bucket): number {
  const i = SEVERITY.indexOf(bucket);
  return i === -1 ? SEVERITY.length : i;
}

/** The package a release-feed item belongs to, from `release:<pkg>` in the match reason. */
export function releasePackage(c: Pick<Candidate, "matchReason">): string | null {
  const m = /(?:^|\+)release:([^+]+)/.exec(c.matchReason);
  return m ? m[1] : null;
}

/** Source kinds that publish releases (one item per version). */
export const RELEASE_KINDS: ReadonlySet<string> = new Set(["github_releases", "changelog_md"]);

/**
 * What "same package" means for folding: the released package, or the feed itself
 * when it only publishes versions of one product (Claude Code's changelog matches
 * through `trait:always`, not `release:`).
 */
/**
 * A package as (ecosystem, name) for keys that join items: npm keeps the bare name, another
 * ecosystem's package of the same name (PyPI `redis`) gets its own key.
 */
function packageIdentity(c: Pick<Candidate, "matchedPackage">, pkg: string): string {
  const ecosystem = c.matchedPackage?.name === pkg ? c.matchedPackage.ecosystem : "npm";
  return ecosystem === "npm" ? pkg : `${ecosystem}:${pkg}`;
}

export function foldKey(
  c: Pick<Candidate, "matchReason" | "sourceKind" | "sourceName" | "title" | "matchedPackage">
): string | null {
  const pkg = releasePackage(c);
  if (pkg) return `package:${packageIdentity(c, pkg)}`;
  if (RELEASE_KINDS.has(c.sourceKind) && extractVersion(c.title)) return `source:${c.sourceName}`;
  return null;
}

function newerFirst(a: Candidate, b: Candidate): number {
  const va = extractVersion(a.title);
  const vb = extractVersion(b.title);
  if (va && vb) {
    const diff = compareVersions(vb, va);
    if (diff !== 0) return diff;
  }
  const byDate = (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0);
  if (byDate !== 0) return byDate;
  // Ties fall back to content so the fold never depends on query order.
  return a.contentHash.localeCompare(b.contentHash);
}

const FOLDED_TEXT_CHARS = 400;

/** Minor by triage, or by title rule (pre-release, commit-sha tag) whatever triage said. */
function isMinor(c: Pick<Candidate, "bucket" | "title">): boolean {
  return c.bucket === "minor" || ruleMinorReason(c.title) !== null;
}

/**
 * Folds several releases of the same package in one window into one candidate,
 * before the model sees them: the newest non-minor release is the primary (title,
 * url, item id), the others are listed in its text and kept as `folded`, and the
 * most severe bucket wins. Releases triaged `minor` fold under a non-minor primary
 * of the same package (a security fix in 10.1.2 followed by 10.1.3 … 10.1.7), so the
 * fix command can name the newest release on the installed line (see
 * releaseVersionsOf); without a non-minor primary they stay minor. Pre-releases and
 * commit-sha tags (rule-minor) never fold.
 */
export function foldReleases(candidates: Candidate[]): Candidate[] {
  const groups = new Map<string, Candidate[]>();
  const minors = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const key = foldKey(c);
    if (!key || ruleMinorReason(c.title) !== null) continue;
    const target = c.bucket === "minor" ? minors : groups;
    target.set(key, [...(target.get(key) ?? []), c]);
  }
  const replaced = new Map<string, Candidate | null>();
  for (const [key, group] of groups) {
    const minorGroup = minors.get(key) ?? [];
    if (group.length + minorGroup.length < 2) continue;
    const [primary, ...nonMinorOthers] = [...group].sort(newerFirst);
    const others = [...nonMinorOthers, ...minorGroup].sort(newerFirst);
    const all = [primary, ...others];
    const bucket = group.reduce<Bucket>(
      (top, c) => (severityRank(c.bucket) < severityRank(top) ? c.bucket : top),
      primary.bucket
    );
    const versions = others.map((o) => extractVersion(o.title)?.text ?? o.title);
    // A severe older release (a security fix in 4.28.1) must stay visible in the folded text.
    const severeNotes = others
      .filter((o) => o.bucket === bucket && primary.bucket !== bucket)
      .map((o) => `${o.title}: ${o.rawText.slice(0, FOLDED_TEXT_CHARS)}`);
    const deadline = group.find((c) => c.bucket === "deadline" && c.dueAt);
    const folded: Candidate = {
      ...primary,
      bucket,
      // Sorted: the hash feeds synthesisInputHash and must not depend on query order.
      contentHash: all
        .map((c) => c.contentHash)
        .sort()
        .join(","),
      rawText: [
        primary.rawText,
        `Also released in this window: ${versions.join(", ")}.`,
        ...severeNotes,
      ]
        .filter(Boolean)
        .join("\n\n"),
      score: Math.max(...all.map((c) => c.score)),
      repoIds: [...new Set(all.flatMap((c) => c.repoIds))],
      keys: { ...primary.keys, topic: bucket },
      dueAt: deadline?.dueAt ?? primary.dueAt,
      dueWhat: deadline?.dueWhat ?? primary.dueWhat,
      folded: [
        ...primary.folded,
        ...others.flatMap((o) => [{ itemId: o.itemId, title: o.title, url: o.url }, ...o.folded]),
      ],
    };
    replaced.set(primary.itemId, folded);
    for (const o of others) replaced.set(o.itemId, null);
  }
  return candidates.flatMap((c) => {
    const r = replaced.get(c.itemId);
    if (r === undefined) return [c];
    return r ? [r] : [];
  });
}

/** Package keys of an item: the matched package plus the packages triage named, deduplicated. */
export function mergePackageKeys(matched: string | null, triaged: readonly string[]): string[] {
  return [
    ...new Set([...(matched ? [matched] : []), ...triaged.map((p) => p.trim()).filter(Boolean)]),
  ];
}

/** An ItemMatch of the period with its item and triage row, as loadCandidates reads it. */
export interface MatchedItemRow {
  score: number;
  reason: string;
  repoIds: unknown;
  packageName: string | null;
  /** `Package.ecosystem` of the match's package; npm when absent. */
  packageEcosystem?: string | null;
  serviceKey: string | null;
  item: {
    id: string;
    contentHash: string;
    title: string;
    url: string;
    rawText: string;
    publishedAt: Date | null;
    metadata: unknown;
    sourceName: string;
    sourceKind: string;
    triage: {
      bucket: string;
      packages: readonly string[];
      dueAt: Date | null;
      dueWhat: string | null;
    } | null;
  };
}

/** Pure: the bulletin candidate of a matched item; null while the item is untriaged. */
export function candidateFromMatch(r: MatchedItemRow): Candidate | null {
  const triage = r.item.triage;
  if (!triage) return null;
  return {
    itemId: r.item.id,
    contentHash: r.item.contentHash,
    title: r.item.title,
    url: r.item.url,
    rawText: r.item.rawText,
    publishedAt: r.item.publishedAt,
    sourceName: r.item.sourceName,
    sourceKind: r.item.sourceKind,
    bucket: triage.bucket as Bucket,
    score: r.score,
    matchReason: r.reason,
    repoIds: Array.isArray(r.repoIds) ? r.repoIds.map(String) : [],
    keys: {
      packages: mergePackageKeys(r.packageName, triage.packages),
      services: r.serviceKey ? [r.serviceKey] : [],
      source: r.item.sourceName,
      topic: triage.bucket,
    },
    dueAt: triage.dueAt,
    dueWhat: triage.dueWhat,
    folded: [],
    runtimeMeta: parseRuntimeMeta(r.item.metadata),
    matchedPackage: r.packageName
      ? { ecosystem: r.packageEcosystem ?? "npm", name: r.packageName }
      : null,
  };
}

/**
 * One install target that fixes every alert of a package: the highest resolved
 * fix. Null when there is none, or when any alert has no single resolved fix
 * (a command would then claim more than we know).
 */
export function highestFix(fixes: readonly (string | null)[]): string | null {
  if (fixes.length === 0 || fixes.some((f) => f === null)) return null;
  let best: { text: string; version: NonNullable<ReturnType<typeof extractVersion>> } | null = null;
  for (const fix of fixes as string[]) {
    const version = extractVersion(fix);
    if (!version || version.text !== fix.trim().replace(/^v/, "")) return null;
    if (!best || compareVersions(version, best.version) > 0) best = { text: version.text, version };
  }
  return best?.text ?? null;
}

function stableVersionOf(title: string): string | null {
  const version = extractVersion(title);
  return version && version.pre === null ? version.text : null;
}

function isReleaseOf(c: Pick<Candidate, "matchReason" | "sourceKind">, pkg: string): boolean {
  const released = releasePackage(c);
  return released ? released === pkg : RELEASE_KINDS.has(c.sourceKind);
}

/**
 * The version a release item is about (from its own title), when the item is a
 * release of `pkg`: a `release:<pkg>` match, or a release feed without a package match.
 */
export function releaseVersionOf(
  c: Pick<Candidate, "matchReason" | "sourceKind" | "title">,
  pkg: string
): string | null {
  return isReleaseOf(c, pkg) ? stableVersionOf(c.title) : null;
}

/**
 * Every stable version a (folded) release item covers: its own and its folded
 * releases'. recommendFixes picks the newest one per installed release line, so a
 * security fix in 10.1.2 followed by 10.1.7 installs 10.1.7, and 11.0.0 stays out of
 * the 10.x command.
 */
export function releaseVersionsOf(
  c: Pick<Candidate, "matchReason" | "sourceKind" | "title" | "folded">,
  pkg: string
): string[] {
  if (!isReleaseOf(c, pkg)) return [];
  return [
    ...new Set([c.title, ...c.folded.map((f) => f.title)].flatMap((t) => stableVersionOf(t) ?? [])),
  ];
}

/**
 * The ecosystem's "what pulls it in" command for a package every affected repo has only
 * transitively; a Python tool's own (`uv tree`) only when every repo uses that tool.
 */
function transitiveWhy(pkg: string, repos: readonly RepoFix[]): string {
  const managers = new Set(repos.map((r) => r.manager));
  const manager = managers.size === 1 ? [...managers][0] : undefined;
  return whyCommand(
    repos.find((r) => r.ecosystem)?.ecosystem,
    pkg,
    manager,
    [...new Set(repos.flatMap((r) => r.project?.split(",") ?? []))].join(",") || undefined
  );
}

/** Whether an item belongs in "do this week", and the action when it can be derived. */
export function actSignals(
  c: Candidate,
  ctx: ActContext,
  /** The item's affected repos: a bare command must cover all of them (fixCommand). */
  affectedRepos: readonly string[] = []
): { mustAct: boolean; suggestedAction: string | null; fixVersions?: string[] } {
  if (c.bucket === "security" && c.runtimeMeta && ctx.runtimes) {
    const runtime = runtimeSignals(c, c.runtimeMeta, ctx.runtimes, ctx.now);
    if (runtime) return runtime;
  }
  if (c.bucket === "security") {
    const pkg = c.keys.packages.find((p) => ctx.alertFixes.has(p));
    if (pkg === undefined) return { mustAct: false, suggestedAction: null };
    const repos = alertFixesOf(c, pkg, ctx);
    const transitiveOnly = repos.length > 0 && repos.every((r) => r.direct === false);
    const releases = releaseVersionsOf(c, pkg);
    return {
      mustAct: true,
      suggestedAction:
        transitiveOnly && ctx.transitiveAction
          ? ctx.transitiveAction(pkg, transitiveWhy(pkg, repos))
          : fixCommand(pkg, releases, repos, undefined, affectedRepos),
      fixVersions: fixVersions(releases, repos),
    };
  }
  if (c.bucket === "deadline" && c.dueAt) {
    const days = (c.dueAt.getTime() - ctx.now.getTime()) / 86_400_000;
    return { mustAct: days <= ACT_DEADLINE_DAYS, suggestedAction: c.dueWhat };
  }
  return { mustAct: false, suggestedAction: null };
}

/**
 * Installed -> target per affected repo for the derived action of a must-act security
 * item: the runtime rows for a runtime item, the alert fixes for a package. Empty for
 * every other item (release upgrades are added after synthesis, see itemUpgrades).
 */
export function candidateUpgrades(
  c: Candidate,
  ctx: ActContext,
  affectedRepos: readonly string[]
): RepoUpgrade[] {
  if (c.bucket !== "security") return [];
  if (c.runtimeMeta && ctx.runtimes) {
    const found = runtimeRowsOf(c, ctx.runtimes);
    if (found) {
      return runtimeUpgrades(found.runtime, c.runtimeMeta, found.rows, ctx.now, affectedRepos);
    }
  }
  const pkg = alertPackage(c, ctx);
  if (pkg === undefined) return [];
  const fixes = alertFixesOf(c, pkg, ctx);
  const ecosystem = ecosystemOfFixes(fixes);
  const alerted = new Set(fixes.map((f) => f.repo));
  const installs = ctx.alertInstalls?.get(pkg);
  return packageUpgrades(
    pkg,
    releaseVersionsOf(c, pkg),
    fixes,
    affectedRepos.filter((r) => !alerted.has(r)),
    (repo) => (installs?.get(repo) ?? []).filter((i) => (i.ecosystem ?? "npm") === ecosystem)
  );
}

const ecosystemOf = (f: Pick<RepoFix, "ecosystem">): string => f.ecosystem ?? "npm";

function ecosystemOfFixes(fixes: readonly RepoFix[]): string {
  return fixes.length > 0 ? ecosystemOf(fixes[0]) : "npm";
}

/**
 * The alert fixes of `pkg` that belong to the item. The maps are keyed by name, and an npm and
 * a PyPI package can share one: then only the entries of the item's matched package's
 * ecosystem count, and an item that names the package without a match to it (a service or
 * mention match) gets none, so no command mixes two packages.
 */
function alertFixesOf(c: Candidate, pkg: string, ctx: ActContext): RepoFix[] {
  const all = ctx.alertFixes.get(pkg) ?? [];
  // The matched package decides whenever there is one, even if only another ecosystem's
  // package of that name has alerts.
  const matched = c.matchedPackage?.name === pkg ? c.matchedPackage.ecosystem : null;
  if (matched) return all.filter((f) => ecosystemOf(f) === matched);
  return new Set(all.map(ecosystemOf)).size <= 1 ? [...all] : [];
}

/**
 * The package whose alert fixes drive a security item's action (actSignals): none for a
 * runtime item, which its runtime rows drive instead.
 */
function alertPackage(c: Candidate, ctx: ActContext): string | undefined {
  if (c.bucket !== "security") return undefined;
  if (c.runtimeMeta && ctx.runtimes && runtimeRowsOf(c, ctx.runtimes)) return undefined;
  return c.keys.packages.find((p) => ctx.alertFixes.has(p));
}

function runtimeRowsOf(
  c: Pick<Candidate, "matchReason" | "repoIds">,
  runtimes: NonNullable<ActContext["runtimes"]>
): { runtime: string; rows: (RuntimeRow & { repoId: string })[] } | null {
  const runtime = matchedRuntimes(c)[0];
  if (!runtime) return null;
  const ids = new Set(c.repoIds);
  return { runtime, rows: (runtimes.get(runtime) ?? []).filter((r) => ids.has(r.repoId)) };
}

/**
 * A runtime security item is must-act when one of the stream's repos runs an
 * affected version of the runtime; the action is derived from its fixed versions
 * (runtimeAction). Null when the item is not about a matched runtime.
 */
function runtimeSignals(
  c: Candidate,
  meta: RuntimeItemMeta,
  runtimes: NonNullable<ActContext["runtimes"]>,
  asOf: Date
): { mustAct: boolean; suggestedAction: string | null } | null {
  const found = runtimeRowsOf(c, runtimes);
  if (!found) return null;
  if (affectedRuntimeRepos(found.runtime, meta, found.rows, asOf).length === 0) {
    return { mustAct: false, suggestedAction: null };
  }
  return { mustAct: true, suggestedAction: runtimeAction(found.runtime, meta, found.rows, asOf) };
}

/**
 * One act item per runtime: the must-act runtime security items of a runtime (a
 * pre-announcement, the advisory post, release posts, GitHub advisories) keep one act item.
 * Its headline item is the incident primary the urgent email uses (incidentPrimary), its
 * action covers the merged incident facts (mergeIncidentMeta); the others drop to the
 * model's choice and fold under it as related (storyKeys share `runtime:<id>`).
 */
export function oneActPerRuntime(
  selected: SelectedCandidate[],
  runtimes: NonNullable<ActContext["runtimes"]>,
  asOf: Date = new Date()
): SelectedCandidate[] {
  const groups = new Map<string, SelectedCandidate[]>();
  for (const c of selected) {
    if (!c.mustAct || c.bucket !== "security" || !c.runtimeMeta) continue;
    const runtime = matchedRuntimes(c)[0];
    if (runtime) groups.set(runtime, [...(groups.get(runtime) ?? []), c]);
  }
  const replaced = new Map<string, SelectedCandidate>();
  for (const [runtime, group] of groups) {
    if (group.length < 2) continue;
    const facts = (c: SelectedCandidate) => ({
      runtime,
      meta: c.runtimeMeta as RuntimeItemMeta,
      publishedAt: c.publishedAt,
      contentHash: c.contentHash,
    });
    const primary = incidentPrimary(group, facts);
    const meta = mergeIncidentMeta(
      runtime,
      primary.runtimeMeta as RuntimeItemMeta,
      group.map((g) => g.runtimeMeta as RuntimeItemMeta)
    );
    const found = runtimeRowsOf(
      { matchReason: primary.matchReason, repoIds: [...new Set(group.flatMap((g) => g.repoIds))] },
      runtimes
    );
    const groupRepos = [...new Set(group.flatMap((g) => g.affectedRepos))].sort();
    replaced.set(primary.itemId, {
      ...primary,
      affectedRepos: groupRepos,
      suggestedAction: found
        ? runtimeAction(runtime, meta, found.rows, asOf)
        : primary.suggestedAction,
      upgrades: found
        ? runtimeUpgrades(runtime, meta, found.rows, asOf, groupRepos)
        : primary.upgrades,
    });
    for (const o of group) {
      if (o !== primary) {
        replaced.set(o.itemId, { ...o, mustAct: false, suggestedAction: null, upgrades: [] });
      }
    }
  }
  return selected.map((c) => replaced.get(c.itemId) ?? c);
}

/** The trait of a platform-wide match (`trait:ios`), or null. */
export function matchTrait(c: Pick<Candidate, "matchReason">): string | null {
  const m = /(?:^|\+)trait:([^+]+)/.exec(c.matchReason);
  return m ? m[1] : null;
}

/**
 * Whether a candidate belongs to a repo scope (one stream): an item pulled in by
 * repos must have at least one of them in scope; a platform-wide item (no repo ids)
 * needs its trait in `traits` when traits are given.
 */
export function inScope(
  c: Pick<Candidate, "repoIds" | "matchReason">,
  repos: ReadonlyMap<string, string>,
  traits?: ReadonlySet<string>
): boolean {
  if (c.repoIds.length > 0) return c.repoIds.some((id) => repos.has(id));
  const trait = matchTrait(c);
  return !traits || !trait || trait === "always" || traits.has(trait);
}

/**
 * Applies repo scope (an item pulled in only by repos outside the stream is dropped, see inScope),
 * interest weights (rank = match score + 0.1 × weight; strongly down-weighted
 * items are dropped, except security and deadlines) and the input cap. Must-act
 * items are kept beyond the cap: assembly always lists them.
 * Rule-minor titles (pre-releases, commit-sha tags) are dropped here too, for rows
 * triaged before those rules existed.
 */
export function selectCandidates(
  candidates: Candidate[],
  includedRepos: ReadonlyMap<string, string>,
  weights: Weights,
  ctx: ActContext = { now: new Date(), alertFixes: new Map() },
  cap = SYNTHESIS_MAX_ITEMS
): SelectedCandidate[] {
  const selected: SelectedCandidate[] = [];
  const streamRepos = new Set(includedRepos.values());
  for (const c of candidates) {
    if (isMinor(c)) continue;
    if (!inScope(c, includedRepos, ctx.traits)) continue;
    const visible = c.repoIds.filter((id) => includedRepos.has(id));
    const weight = itemWeight(weights, c.keys);
    const protectedBucket = c.bucket === "security" || c.bucket === "deadline";
    if (!protectedBucket && weight <= EXCLUDE_AT) continue;
    // A repo with an alert on the item's package is affected whatever the match recorded:
    // the derived fix command covers it, so the item's repos (and the model's input) do too.
    const pkg = alertPackage(c, ctx);
    const alerted = pkg ? alertFixesOf(c, pkg, ctx).map((f) => f.repo) : [];
    const affectedRepos = [
      ...new Set([
        ...visible.map((id) => includedRepos.get(id) as string),
        ...alerted.filter((r) => streamRepos.has(r)),
      ]),
    ].sort();
    const signals = actSignals(c, ctx, affectedRepos);
    selected.push({
      ...c,
      ...signals,
      rank: c.score + WEIGHT_FACTOR * weight,
      affectedRepos,
      upgrades: signals.mustAct ? candidateUpgrades(c, ctx, affectedRepos) : [],
    });
  }
  const ranked = (ctx.runtimes ? oneActPerRuntime(selected, ctx.runtimes, ctx.now) : selected).sort(
    (a, b) => b.rank - a.rank || (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0)
  );
  return ranked.filter((c, i) => i < cap || c.mustAct);
}

/** Minor items that would have been visible (same inclusion rule), for the count line. */
export function countMinor(
  candidates: Candidate[],
  includedRepos: ReadonlyMap<string, string>,
  traits?: ReadonlySet<string>
): number {
  return candidates.filter((c) => isMinor(c) && inScope(c, includedRepos, traits)).length;
}

export interface StackRepo {
  name: string;
  /**
   * Direct dependencies with their installed versions (and the ecosystem when it is not npm,
   * `dev` when declared only for development, the Python tool, and `unresolved` when the
   * version is a requirement, not an install).
   */
  dependencies: {
    name: string;
    version: string;
    ecosystem?: Exclude<Ecosystem, "npm">;
    dev?: true;
    group?: string;
    requirement?: string;
    project?: string;
    actionTags?: Record<string, string>;
    manager?: PackageManager;
    unresolved?: true;
  }[];
  services: string[];
  /** Declared runtimes (`php` + `8.3`); `version` is the normalised one when derivable. */
  runtimes?: { name: string; version: string }[];
}

/** A repo as the model sees it: only packages the selected items mention, plus services. */
export interface SynthesisStackRepo {
  name: string;
  packages: string[];
  services: string[];
  /** `php 8.3`, only for runtimes a selected item matched on; absent when none. */
  runtimes?: string[];
}

/** Runtime ids an item matched on (`runtime:php`). */
export function matchedRuntimes(c: Pick<Candidate, "matchReason">): string[] {
  return [...c.matchReason.matchAll(/(?:^|\+)runtime:([^+]+)/g)].map((m) => m[1]);
}

/**
 * Narrows the stack to what the selected items reference: the full direct
 * dependency list of every repo was most of the synthesis input and rarely used.
 */
export function stackForSynthesis(
  stack: readonly StackRepo[],
  selected: readonly Pick<Candidate, "keys" | "matchReason">[]
): SynthesisStackRepo[] {
  const referenced = new Set(selected.flatMap((c) => c.keys.packages));
  const runtimeIds = new Set(selected.flatMap(matchedRuntimes));
  return stack.map((r) => {
    const runtimes = [
      ...new Set(
        (r.runtimes ?? [])
          .filter((rt) => runtimeIds.has(rt.name))
          .map((rt) => `${rt.name} ${rt.version}`)
      ),
    ];
    return {
      name: r.name,
      packages: r.dependencies
        .filter((d) => referenced.has(d.name))
        // A requirement (`~=2.0`) is no installed version; the model must not read it as one.
        .map((d) =>
          d.unresolved ? `${d.name} (requires ${d.version})` : `${d.name}@${d.version}`
        ),
      services: r.services,
      // Omitted when empty so stacks without runtime items keep their input hash.
      ...(runtimes.length > 0 ? { runtimes } : {}),
    };
  });
}

export interface SecurityAlertSummary {
  package: string;
  severity: string | null;
  osvId: string;
  repos: string[];
  fixed: string | null;
}

/** One alert of the period with the repo's installed versions of its package. */
export interface PeriodAlert {
  kind: "backlog" | "new";
  repo: string;
  osvId: string;
  severity: string | null;
  affected: OsvRange[];
  packageName: string;
  /** The package's ecosystem; npm when absent. */
  ecosystem?: Ecosystem;
  installed: readonly {
    version: string;
    direct: boolean;
    dev?: boolean;
    group?: string;
    requirement?: string;
    project?: string;
    actionTags?: Record<string, string>;
    manager?: PackageManager;
  }[];
}

/**
 * Synthesis summaries (new alerts only) and the per-package repo fixes (every alert).
 * A repo can install a package in several versions; only the versions the advisory
 * affects get an entry, so a version already past the fix does not void the command.
 * A package whose installed versions are unknown still gets a (then empty) entry.
 */
export function summariseAlerts(rows: readonly PeriodAlert[]): {
  summaries: SecurityAlertSummary[];
  repoFixes: Map<string, RepoFix[]>;
} {
  const byId = new Map<string, SecurityAlertSummary & { fixes: (string | null)[] }>();
  const repoFixes = new Map<string, RepoFix[]>();
  for (const r of rows) {
    const pkg = r.packageName;
    const affected = affectedInstalls(r.affected, r.installed, (i) => i.version);
    const entries = affected.map((i) => ({
      repo: r.repo,
      installed: i.version,
      fix: fixedVersionFor(r.affected, i.version),
      direct: i.direct,
      ...(r.ecosystem && r.ecosystem !== "npm" ? { ecosystem: r.ecosystem } : {}),
      ...(i.dev ? { dev: true } : {}),
      ...(i.group ? { group: i.group } : {}),
      ...(i.requirement ? { requirement: i.requirement } : {}),
      ...(i.project ? { project: i.project } : {}),
      ...(i.actionTags ? { actionTags: i.actionTags } : {}),
      ...(i.manager ? { manager: i.manager } : {}),
    }));
    if (entries.length > 0) repoFixes.set(pkg, [...(repoFixes.get(pkg) ?? []), ...entries]);
    else if (r.installed.length === 0 && !repoFixes.has(pkg)) repoFixes.set(pkg, []);
    if (r.kind !== "new") continue;
    const entry = byId.get(r.osvId) ?? {
      package: pkg,
      severity: r.severity,
      osvId: r.osvId,
      repos: [] as string[],
      fixed: null,
      fixes: [],
    };
    if (!entry.repos.includes(r.repo)) entry.repos.push(r.repo);
    entry.fixes.push(...(entries.length > 0 ? entries.map((e) => e.fix) : [null]));
    byId.set(r.osvId, entry);
  }
  return {
    summaries: [...byId.values()].map(({ fixes, ...summary }) => ({
      ...summary,
      fixed: highestFix(fixes),
    })),
    repoFixes,
  };
}

export interface SynthesisInput {
  language: string;
  week: string;
  profile: { text: string; weights: Weights };
  stack: SynthesisStackRepo[];
  items: {
    ref: number;
    bucket: Bucket;
    title: string;
    source: string;
    url: string;
    published: string | null;
    affected_repos: string[];
    packages: string[];
    must_act: boolean;
    suggested_action: string | null;
    /** Versions that fix this item's advisories on the installed release lines, newest first. */
    fix_versions: string[];
    due: string | null;
    also_released: string[];
    text: string;
  }[];
  minor_count: number;
  security_alerts: SecurityAlertSummary[];
}

/** Alert-only input (no selected items) keeps at most this many advisories. */
export const ALERT_ONLY_LIMIT = 20;

/**
 * Advisories whose package one of the selected items mentions. Without selected
 * items the alerts are all the bulletin has: keep the most severe ones, grouped
 * per package (packages ordered by their most severe advisory).
 */
export function alertsForSynthesis(
  alerts: readonly SecurityAlertSummary[],
  selected: readonly Pick<Candidate, "keys">[]
): SecurityAlertSummary[] {
  if (selected.length === 0) {
    const kept = [...alerts]
      .sort(
        (a, b) =>
          advisoryRank(b.severity) - advisoryRank(a.severity) || a.osvId.localeCompare(b.osvId)
      )
      .slice(0, ALERT_ONLY_LIMIT);
    const top = new Map<string, number>();
    for (const a of kept)
      top.set(a.package, Math.max(top.get(a.package) ?? 0, advisoryRank(a.severity)));
    return kept
      .map((a, i) => ({ a, i }))
      .sort(
        (x, y) =>
          (top.get(y.a.package) ?? 0) - (top.get(x.a.package) ?? 0) ||
          x.a.package.localeCompare(y.a.package) ||
          x.i - y.i
      )
      .map(({ a }) => a);
  }
  const referenced = new Set(selected.flatMap((c) => c.keys.packages));
  return alerts.filter((a) => referenced.has(a.package));
}

export function buildSynthesisInput(args: {
  language: string;
  week: string;
  profileText: string;
  weights: Weights;
  stack: StackRepo[];
  selected: SelectedCandidate[];
  minorCount: number;
  alerts: SecurityAlertSummary[];
}): SynthesisInput {
  return {
    language: args.language,
    week: args.week,
    profile: { text: args.profileText, weights: args.weights },
    stack: stackForSynthesis(args.stack, args.selected),
    items: args.selected.map((c, i) => ({
      ref: i + 1,
      bucket: c.bucket,
      title: c.title,
      source: c.sourceName,
      url: c.url,
      published: c.publishedAt?.toISOString().slice(0, 10) ?? null,
      affected_repos: c.affectedRepos,
      packages: [...new Set([...c.keys.packages, ...c.keys.services])],
      must_act: c.mustAct,
      suggested_action: c.suggestedAction,
      fix_versions: c.fixVersions ?? [],
      due: c.dueAt?.toISOString().slice(0, 10) ?? null,
      also_released: c.folded.map((f) => f.title),
      text: c.rawText.slice(
        0,
        c.bucket === "security" || c.bucket === "deadline" ? PROTECTED_TEXT_CHARS : TEXT_CHARS
      ),
    })),
    minor_count: args.minorCount,
    // The model only writes about items; advisories for packages no item mentions were
    // half of the input in a stream with a large alert backlog.
    security_alerts: alertsForSynthesis(args.alerts, args.selected),
  };
}

/**
 * Same stream, model, prompt and input → same hash → no regeneration. Item content
 * enters via contentHash. The stream id keeps two streams with the same input apart.
 */
export function synthesisInputHash(
  model: string,
  promptVersion: string,
  input: SynthesisInput,
  selected: SelectedCandidate[],
  streamId: string | null = null
): string {
  return sha256Hex(
    JSON.stringify({
      ...(streamId ? { streamId } : {}),
      model,
      promptVersion,
      input: { ...input, items: input.items.map((item) => ({ ...item, text: undefined })) },
      hashes: selected.map((c) => c.contentHash),
    })
  );
}

export const ACT_LIMIT = 5;
export const KNOW_LIMIT = 5;

export const TODO_KINDS = ["upgrade", "read", "wait", "ignore"] as const;
export type TodoKind = (typeof TODO_KINDS)[number];
export type Section = "act" | "know" | "rest";

const entryProperties = {
  ref: { type: "integer" },
  headline: { type: "string" },
  line: { type: "string" },
} as const;

export const SYNTHESIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "act", "know"],
  properties: {
    summary: { type: "string" },
    act: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "headline", "line", "action"],
        properties: { ...entryProperties, action: { type: "string" } },
      },
    },
    know: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "headline", "line", "what_to_do"],
        properties: {
          ...entryProperties,
          what_to_do: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "note"],
            properties: {
              kind: { type: "string", enum: [...TODO_KINDS] },
              note: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;

const entry = { ref: z.number().int(), headline: z.string(), line: z.string() };

export const synthesisOutputSchema = z.object({
  summary: z.string(),
  act: z.array(z.object({ ...entry, action: z.string() })),
  know: z.array(
    z.object({
      ...entry,
      what_to_do: z.object({ kind: z.enum(TODO_KINDS), note: z.string() }),
    })
  ),
});

export type SynthesisOutput = z.infer<typeof synthesisOutputSchema>;

export interface BulletinItemDraft {
  itemId: string;
  bucket: Bucket;
  section: Section;
  order: number;
  headline: string;
  line: string;
  action: string;
  todo: TodoKind | null;
  affectedRepos: string[];
  foldedItemIds: string[];
}

/**
 * Installed -> target per repo for an assembled act/know item, or empty when its action
 * recommends no version. Security items keep what selection derived (the action is the
 * derived one, see chooseAction). A release item gets lines when its action installs a
 * version of the released package or its to-do is "upgrade"; installed versions come
 * from the stream's stack (direct dependencies).
 */
const ecosystemOfDep = (dep: { ecosystem?: string }): string => dep.ecosystem ?? "npm";

function asEcosystemNonNpm(value: string): Exclude<Ecosystem, "npm"> | undefined {
  const ecosystem = asEcosystem(value);
  return ecosystem && ecosystem !== "npm" ? ecosystem : undefined;
}

export function itemUpgrades(
  d: Pick<BulletinItemDraft, "section" | "action" | "todo" | "affectedRepos">,
  c: SelectedCandidate,
  stack: readonly Pick<StackRepo, "name" | "dependencies">[]
): RepoUpgrade[] {
  if (d.section === "rest") return [];
  if (c.upgrades && c.upgrades.length > 0) return alignUpgrades(c.upgrades, d.affectedRepos);
  const pkg = releasePackage(c);
  if (!pkg || d.affectedRepos.length === 0) return [];
  const commands = isCommand(d.action) && installTargets(d.action, pkg) !== null;
  if (!commands && d.todo !== "upgrade") return [];
  const deps = new Map(stack.map((r) => [r.name, r.dependencies]));
  // One name can be two packages (npm and PyPI `redis`): the released package is the
  // match's; without one, only a name a single ecosystem uses in the stack is clear.
  const used = new Set(
    stack.flatMap((r) => r.dependencies.filter((dep) => dep.name === pkg)).map(ecosystemOfDep)
  );
  const released =
    c.matchedPackage?.name === pkg
      ? c.matchedPackage.ecosystem
      : used.size <= 1
        ? ([...used][0] ?? "npm")
        : null;
  if (released === null) return [];
  const ecosystem = released === "npm" ? undefined : asEcosystemNonNpm(released);
  const own = (repo: string) =>
    (deps.get(repo) ?? []).filter((dep) => dep.name === pkg && ecosystemOfDep(dep) === released);
  return alignUpgrades(
    releaseUpgrades(
      pkg,
      d.action,
      releaseVersionsOf(c, pkg),
      d.affectedRepos,
      // A requirement (`>=2.0`) is not an installed version: such a repo reads "unknown".
      (repo) => own(repo).flatMap((dep) => (dep.unresolved ? [] : [dep.version])),
      ecosystem,
      (repo, version) => {
        // The declaration of that installed version; without one, the repo's first.
        const dep = own(repo).find((d) => d.version === version && !d.unresolved) ?? own(repo)[0];
        if (!dep) return {};
        return {
          ...(dep.dev ? { dev: true } : {}),
          ...(dep.group ? { group: dep.group } : {}),
          ...(dep.requirement ? { requirement: dep.requirement } : {}),
          ...(dep.project ? { project: dep.project } : {}),
          ...(dep.actionTags ? { actionTags: dep.actionTags } : {}),
          ...(dep.manager ? { manager: dep.manager } : {}),
        };
      }
    ),
    d.affectedRepos
  );
}

/**
 * Keys that say two items are about the same product: the matched services, the
 * packages matched by release or mention (`release:next`, `mention:next`) and the
 * matched runtimes (`runtime:php`). Packages the model named during triage are left
 * out; they are too broad for folding.
 */
export function storyKeys(c: Pick<Candidate, "keys" | "matchReason" | "matchedPackage">): string[] {
  const keys = c.keys.services.map((s) => `service:${s}`);
  for (const runtime of matchedRuntimes(c)) keys.push(`runtime:${runtime}`);
  for (const m of c.matchReason.matchAll(/(?:^|\+)(?:release|mention):([^+]+)/g)) {
    keys.push(`package:${packageIdentity(c, m[1])}`);
  }
  return [...new Set(keys)];
}

const URL_IN_TEXT = /https?:\/\/\S+/g;

const COMMAND =
  /^(npm|npx|yarn|pnpm|bun|bunx|eas|expo|git|brew|pip|cargo|go|docker|composer|uv|poetry|pipenv|pipdeptree)\s/;

/** A shell command rather than a sentence (rendered monospace; the derived one wins). */
export function isCommand(action: string): boolean {
  return COMMAND.test(action.trim()) || /^pin [\w.-]+\/[\w.-]+ to \S+/.test(action.trim());
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A repo is named by its full name or its last path segment (`pantheon` for `sigma/pantheon`). */
function namesRepo(text: string, repo: string): boolean {
  const names = [...new Set([repo, repo.split("/").pop() ?? repo])].filter(Boolean);
  return names.some((name) =>
    new RegExp(`(?<![\\w./-])${escapeRegExp(name)}(?![\\w/-])`, "i").test(text)
  );
}

/**
 * True when a sentence names some of the affected repos but not all of them: it reads as
 * if the others need nothing (an Express action naming three of five repos).
 */
export function namesRepoSubset(action: string, repos: readonly string[]): boolean {
  if (repos.length < 2) return false;
  const named = repos.filter((r) => namesRepo(action, r)).length;
  return named > 0 && named < repos.length;
}

/** "Also affects a, b." when a line leaves those affected repos out. */
export type AlsoAffected = (repos: readonly string[]) => string;

/**
 * A line that names some of the affected repos but not all of them reads as if the others
 * were unaffected (the prompt's all-or-none rule, which the model does not always keep):
 * the missing repos are appended, in affected-repo order. A line naming all or none is
 * returned as it is.
 */
export function completeRepoNames(
  line: string,
  repos: readonly string[],
  alsoAffected: AlsoAffected
): string {
  if (!namesRepoSubset(line, repos)) return line;
  const missing = repos.filter((r) => !namesRepo(line, r));
  const text = line.trim();
  return `${text}${/[.!?]$/.test(text) ? "" : "."} ${alsoAffected(missing)}`;
}

/**
 * The act action. A security must-act item with a derived action (the per-line fix
 * command, or the transitive sentence) always uses it, as does a model command when a
 * derived command exists. A model sentence that names only some affected repos falls
 * back to the derived action, else the localised fallback for must-act items.
 */
export function chooseAction(
  modelAction: string,
  c: SelectedCandidate,
  fallbackAction: (c: SelectedCandidate) => string
): string {
  const derived = c.suggestedAction;
  if (derived && c.bucket === "security" && c.mustAct) return derived;
  if (derived && isCommand(derived) && isCommand(modelAction)) return derived;
  if (modelAction && namesRepoSubset(modelAction, c.affectedRepos)) {
    return derived || (c.mustAct ? fallbackAction(c) : modelAction);
  }
  return modelAction || derived || (c.mustAct ? fallbackAction(c) : "");
}

function clean(text: string, max: number): string {
  return text.replace(URL_IN_TEXT, "").replace(/\s+/g, " ").trim().slice(0, max);
}

const GITHUB_SOURCE = /^([\w.-]+)\/([\w.-]+) releases$/;

function nameTokens(name: string): string[] {
  const n = name.trim().toLowerCase();
  if (!n) return [];
  const unscoped = n.replace(/^@/, "");
  return [n, unscoped, ...unscoped.split("/")];
}

/**
 * Names that identify a release item: its `release:<pkg>` / `package:` keys (with and
 * without `@scope/`), the GitHub `owner/repo` of its source, and its title's leading
 * token (`nodemailer/nodemailer`, `expo@55.0.0` → `expo`). Empty for items that are not
 * releases: a blog post's leading word ("Introducing") says nothing about its subject.
 */
export function identityTokens(
  c: Pick<Candidate, "matchReason" | "sourceKind" | "sourceName" | "title">
): string[] {
  if (!foldKey(c)) return [];
  const tokens: string[] = [];
  for (const m of c.matchReason.matchAll(/(?:^|\+)(?:release|package):([^+]+)/g)) {
    tokens.push(...nameTokens(m[1]));
  }
  const gh = GITHUB_SOURCE.exec(c.sourceName.trim());
  if (gh) tokens.push(...nameTokens(`${gh[1]}/${gh[2]}`));
  const lead = c.title.trim().split(/\s+/)[0] ?? "";
  // "expo@55.0.0" → "expo"; a scoped name keeps its leading "@".
  const leadName = lead.replace(/(?<=.)@.*$/, "").replace(/[:,;]+$/, "");
  tokens.push(...nameTokens(leadName));
  return [...new Set(tokens.filter((t) => t.length >= 2))];
}

/**
 * Whether model text is about the item its ref points to: it mentions at least one
 * identity token (case-insensitive, whole name). True when the item has no tokens.
 */
export function mentionsIdentity(text: string, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return true;
  return tokens.some((t) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(t)}(?![\\p{L}\\p{N}])`, "iu").test(text)
  );
}

/** The item's first sentence (cleaned), or empty when it has none within 300 characters. */
export function firstSentence(text: string): string {
  const m = /^.{1,300}?[.!?](?=\s|$)/.exec(clean(text, 600));
  return m ? m[0] : "";
}

export interface RefMismatch {
  itemId: string;
  /** First 80 characters of the model text that was replaced. */
  text: string;
}

type Draft = Omit<BulletinItemDraft, "order">;

function withoutMustAct(d: Draft & { mustAct: boolean }): Draft {
  const { mustAct, ...rest } = d;
  void mustAct;
  return rest;
}

const VERSION_TOKEN = /(?<![\w.-])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)(?![\w-]|\.\d)/g;

function versionTokens(text: string): string[] {
  return [...text.matchAll(VERSION_TOKEN)].map((m) => m[1]);
}

/**
 * A security headline names the fix for the installed lines, not the release the feed
 * item is about: a version of the item's own (or folded) titles that is not one of
 * `fixVersions` is replaced by them ("Fastify 5.12.6 security release" with fix 5.12.7
 * becomes "Fastify 5.12.7 security release"). Only versions from the input are used.
 */
export function boundHeadline(
  headline: string,
  c: Pick<SelectedCandidate, "title" | "folded" | "fixVersions">
): string {
  const fixes = c.fixVersions ?? [];
  if (fixes.length === 0) return headline;
  const released = new Set([c.title, ...c.folded.map((f) => f.title)].flatMap(versionTokens));
  const fixed = new Set(fixes);
  return headline.replace(VERSION_TOKEN, (token: string, version: string) =>
    released.has(version) && !fixed.has(version) ? fixes.join(" / ") : token
  );
}

function draft(
  c: SelectedCandidate,
  section: Section,
  fields: Partial<Pick<Draft, "headline" | "line" | "action" | "todo">> = {}
): Draft {
  return {
    itemId: c.itemId,
    bucket: c.bucket,
    section,
    // Every section: must-act overflow lands in `rest` and is still shown on the page.
    headline: boundHeadline(fields.headline || c.title, c),
    line: fields.line ?? "",
    action: fields.action ?? "",
    todo: fields.todo ?? null,
    affectedRepos: c.affectedRepos,
    foldedItemIds: c.folded.map((f) => f.itemId),
  };
}

/**
 * Model headline and line for an item, unless they describe another item: a release
 * item whose model text names none of its identity tokens gets its own title and
 * first sentence instead (the section and to-do stay), recorded in `mismatches`.
 */
function modelText(
  c: SelectedCandidate,
  headline: string,
  line: string,
  mismatches: RefMismatch[]
): { headline: string; line: string } {
  const h = clean(headline, 200);
  const l = clean(line, 600);
  if (mentionsIdentity(`${h}\n${l}`, identityTokens(c))) return { headline: h, line: l };
  mismatches.push({ itemId: c.itemId, text: `${h} ${l}`.trim().slice(0, 80) });
  return { headline: c.title, line: firstSentence(c.rawText) };
}

/**
 * Turns model output into a capped to-do list. Only refs present in the input
 * survive (no claim without a source item), and a release item's text must name it
 * (see modelText). `act` items need an action (the
 * model's, else the derived one) and `know` items a what-to-do; entries without
 * one fall to `rest`. Must-act items always end up in `act`, also when the model
 * filed them under `know` or left them out, with the derived action or the
 * localised fallback. Both lists are capped; everything else that was
 * selected is kept as `rest`, which the email only counts and the page lists.
 * A non-release `rest` item that shares a story key (see storyKeys) with a
 * security act item is folded under that act item instead of listed again.
 */
export function assembleBulletin(
  output: SynthesisOutput,
  selected: SelectedCandidate[],
  /** Localised action for a must-act item with no derivable command, so it is never dropped. */
  fallbackAction: (c: SelectedCandidate) => string = (c) => c.title,
  /** Localised tail for a line that names only some affected repos (completeRepoNames). */
  alsoAffected: AlsoAffected = (repos) => `Also affects ${repos.join(", ")}.`
): { summary: string; items: BulletinItemDraft[]; refMismatches: RefMismatch[] } {
  const refMismatches: RefMismatch[] = [];
  const textOf = (c: SelectedCandidate, headline: string, line: string) => {
    const text = modelText(c, headline, line, refMismatches);
    return { ...text, line: completeRepoNames(text.line, c.affectedRepos, alsoAffected) };
  };
  const byRef = new Map(selected.map((c, i) => [i + 1, c]));
  const used = new Set<string>();
  const take = (ref: number): SelectedCandidate | null => {
    const c = byRef.get(ref);
    if (!c || used.has(c.itemId)) return null;
    return c;
  };

  const act: (Draft & { mustAct: boolean })[] = [];
  for (const e of output.act) {
    const c = take(e.ref);
    if (!c) continue;
    const action = chooseAction(clean(e.action, 300), c, fallbackAction);
    if (!action) continue;
    used.add(c.itemId);
    act.push({
      ...draft(c, "act", { ...textOf(c, e.headline, e.line), action }),
      mustAct: c.mustAct,
    });
  }
  const know: Draft[] = [];
  for (const e of output.know) {
    const c = take(e.ref);
    if (!c) continue;
    used.add(c.itemId);
    if (c.mustAct) {
      // The model filed a must-act item under "know"; it still belongs in "act".
      act.push({
        ...draft(c, "act", {
          ...textOf(c, e.headline, e.line),
          action: chooseAction(clean(e.what_to_do.note, 300), c, fallbackAction),
        }),
        mustAct: true,
      });
      continue;
    }
    know.push(
      draft(c, "know", {
        ...textOf(c, e.headline, e.line),
        action: clean(e.what_to_do.note, 200),
        todo: e.what_to_do.kind,
      })
    );
  }
  for (const c of selected) {
    if (used.has(c.itemId) || !c.mustAct) continue;
    used.add(c.itemId);
    act.push({
      ...draft(c, "act", { action: c.suggestedAction || fallbackAction(c) }),
      mustAct: true,
    });
  }

  // Must-act items keep their place when the model listed more than the cap.
  const actSorted = act
    .map((d, i) => ({ d, i }))
    .sort((a, b) => Number(b.d.mustAct) - Number(a.d.mustAct) || a.i - b.i)
    .map(({ d }) => d);
  const actKept = actSorted.slice(0, ACT_LIMIT);
  const knowKept = know.slice(0, KNOW_LIMIT);
  const kept = new Set([...actKept, ...knowKept].map((d) => d.itemId));
  const restCandidates = selected.filter((c) => !kept.has(c.itemId));
  const byItem = new Map(selected.map((c) => [c.itemId, c]));
  const securityAct = actKept.flatMap((d) => {
    const c = byItem.get(d.itemId);
    return c && c.bucket === "security" ? [{ d, keys: new Set(storyKeys(c)) }] : [];
  });
  const rest: Draft[] = [];
  for (const c of restCandidates) {
    const target = RELEASE_KINDS.has(c.sourceKind)
      ? undefined
      : securityAct.find((a) => storyKeys(c).some((k) => a.keys.has(k)));
    if (!target) {
      rest.push(draft(c, "rest"));
      continue;
    }
    // A blog post on the same story as a security act item is listed under it, not repeated.
    target.d.foldedItemIds = [
      ...target.d.foldedItemIds,
      c.itemId,
      ...c.folded.map((f) => f.itemId),
    ];
  }

  const ordered: Draft[] = [...actKept.map(withoutMustAct), ...knowKept, ...rest];
  return {
    summary: clean(output.summary, 600),
    items: ordered.map((d, order) => ({ ...d, order })),
    refMismatches,
  };
}

/** Subjects stay within this many characters when the stream name allows it. */
export const SUBJECT_MAX = 78;

/**
 * Short name of an item for the subject line: its package (release feed first),
 * else its service, else the first three words of the headline.
 */
export function subjectTopic(c: Pick<Candidate, "keys" | "matchReason">, headline: string): string {
  const pkg = releasePackage(c) ?? c.keys.packages[0];
  if (pkg) return pkg;
  const service = c.keys.services[0];
  if (service) return serviceByKey(service)?.name ?? service;
  // A runtime item is named by its runtime, like a package by its name: titles of runtime
  // posts start with a date or a generic word ("Security advisory: ...").
  const runtime = matchedRuntimes(c)[0];
  if (runtime) return runtimeName(runtime);
  return headline
    .replace(/[^\p{L}\p{N}@/._ -]+/gu, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join(" ");
}

/**
 * `Briff · <stream> · W43: undici · nodemailer and more`, built from the topics
 * of the act items (see subjectTopic); `…: nothing urgent this week` without any.
 */
export function bulletinSubject(stream: string, weekLabel: string, topics: string[]): string {
  const week = weekLabel.replace(/^\d{4}-/, "");
  const prefix = `Briff · ${stream.trim() || "Bulletin"} · ${week}: `;
  const seen = new Set<string>();
  const unique = topics
    .map((t) => t.trim())
    .filter((t) => {
      const key = t.toLowerCase();
      if (!t || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (unique.length === 0) return `${prefix}nothing urgent this week`;
  const build = (names: string[]) =>
    `${prefix}${names.join(" · ")}${unique.length > names.length ? " and more" : ""}`;
  const two = build(unique.slice(0, 2));
  if (two.length <= SUBJECT_MAX) return two;
  const one = build(unique.slice(0, 1));
  if (one.length <= SUBJECT_MAX) return one;
  // One name that is still too long: shorten the name, keep the prefix and the tail.
  const tail = unique.length > 1 ? " and more" : "";
  const room = Math.max(8, SUBJECT_MAX - prefix.length - tail.length);
  const name = unique[0].length > room ? `${unique[0].slice(0, room - 1).trimEnd()}…` : unique[0];
  return `${prefix}${name}${tail}`;
}

/**
 * The topics part of a subject from bulletinSubject (or the older
 * `Briff · 2026-W42: …`). Stream names are user text and may contain ": ", so the
 * known prefix is stripped when the stream is known; otherwise the first
 * ` · W43: ` week marker ends the prefix.
 */
export function subjectTopics(subject: string, streamName: string | null): string {
  const prefix = streamName ? `Briff · ${streamName.trim() || "Bulletin"} · ` : null;
  if (prefix && subject.startsWith(prefix)) {
    const m = /^W\d{1,2}: /.exec(subject.slice(prefix.length));
    if (m) return subject.slice(prefix.length + m[0].length);
  }
  const m = /^Briff · (?:\d{4}-W\d{1,2}|.*? · W\d{1,2}): /.exec(subject);
  return m ? subject.slice(m[0].length) : subject;
}
