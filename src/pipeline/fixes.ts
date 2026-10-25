import semver from "semver";

import type { Ecosystem, PackageManager } from "@scan/ecosystems";

import { installCommand, type InstallVariant } from "./install-commands";

// One fix command per package and installed release line (bulletin quality, §14 item 2).
// The OSV fix depends on the installed version and can lag the release the item is
// about, so the item's own release version is considered per line as well.

/** One advisory's resolved fix for one repo; a repo with several advisories has several entries. */
export interface RepoFix {
  repo: string;
  installed: string;
  /** OSV-resolved fix for the installed version; null when unknown. */
  fix: string | null;
  /** False for a transitive dependency (no command: the repo does not install it itself). */
  direct?: boolean;
  /** The package's ecosystem, which picks the command; npm when absent. */
  ecosystem?: Ecosystem;
  /** The repo declares it only for development (`require-dev`): `composer require --dev`. */
  dev?: boolean;
  /** The dependency group of a development-only Python package (`test`). */
  group?: string;
  /** The requirement as the manifest declares it (extras and markers kept in the command). */
  requirement?: string;
  /** The uv workspace member that declares it (`uv add --package api`). */
  project?: string;
  /** The Python tool whose lockfile listed it in this repo (`uv lock`, `poetry add`, ...). */
  manager?: PackageManager;
}

/** The install variant a repo needs for the package, from its entries (already on one line). */
/** How one installed version is declared (its own entry: section, shape, member, tool). */
function variantOf(f: RepoFix): InstallVariant {
  return {
    ...(f.dev ? { dev: true } : {}),
    ...(f.group ? { group: f.group } : {}),
    ...(f.requirement ? { requirement: f.requirement } : {}),
    ...(f.project ? { project: f.project } : {}),
    ...(f.manager ? { manager: f.manager } : {}),
  };
}

/** Whether an installed version is on the release line of `version` (the fix it gets). */
function onLineOf(installed: string, version: string): boolean {
  const valid = semver.valid(installed);
  return valid !== null && releaseLine(valid) === releaseLine(version);
}

/**
 * Splits the repos that install `version` by how each installs the package (InstallVariant):
 * one group when they all install it alike, else one per variant (`composer require` and
 * `composer require --dev`, or `uv lock` and `poetry add`, on the same line). Only a repo's
 * entries on that version's release line count: a repo can require one line for production
 * and another for development (two composer.json files).
 */
export function byInstallVariant(
  repos: readonly string[],
  fixes: readonly RepoFix[],
  version: string
): { variant: InstallVariant; repos: string[] }[] {
  // Per installed version, not per repo: one repo can declare two pins of a line differently
  // (`==1.0.0; linux`, `==1.0.1; win32`), and each declaration gets its own command.
  const lineFixes = fixes.filter((f) => repos.includes(f.repo) && onLineOf(f.installed, version));
  const groups = new Map<string, { variant: InstallVariant; repos: string[] }>();
  for (const f of lineFixes) {
    const variant = variantOf(f);
    const key = JSON.stringify(variant);
    const group = groups.get(key) ?? { variant, repos: [] };
    if (!group.repos.includes(f.repo)) group.repos.push(f.repo);
    groups.set(key, group);
  }
  // A repo whose version has no comparable entry still gets the plain command.
  for (const repo of repos) {
    if ([...groups.values()].some((g) => g.repos.includes(repo))) continue;
    const group = groups.get("{}") ?? { variant: {}, repos: [] };
    group.repos.push(repo);
    groups.set("{}", group);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, repos: [...g.repos].sort() }))
    .sort((a, b) => a.repos[0].localeCompare(b.repos[0]));
}

export interface LineFix {
  version: string;
  repos: string[];
}

const COMMAND_MAX = 300;

/**
 * The clause for an installed line without a safe fix (parsed back by bulletin-by-repo.ts):
 * `9.x has no known fix, ...`, or the installed version itself when it has no semver form
 * and so no line (`2.0.0.1 has no known fix, ...`).
 */
export const NO_FIX_CLAUSE = /^(\d+(?:\.\d+)?\.x|\S+) has no known fix, read the advisory: (.+)$/;

function noFixClause(line: string, repos: readonly string[]): string {
  const label = /^\d+(?:\.\d+)?$/.test(line) ? `${line}.x` : line;
  return `${label} has no known fix, read the advisory: ${repos.join(", ")}`;
}

/** Release line: the major version, or `0.<minor>` below 1.0 (where minors break). */
export function releaseLine(version: string): string {
  const v = semver.parse(version);
  if (!v) return version;
  return v.major === 0 ? `0.${v.minor}` : String(v.major);
}

function stable(version: string | null): string | null {
  if (!version) return null;
  const v = semver.valid(version.trim().replace(/^v/, ""));
  return v && semver.prerelease(v) === null ? v : null;
}

/** The item's release versions: one, several (a folded release group) or none. */
export type ReleaseVersions = string | readonly string[] | null;

function stableReleases(release: ReleaseVersions): string[] {
  const list = release === null ? [] : typeof release === "string" ? [release] : release;
  return list.flatMap((r) => stable(r) ?? []);
}

/** The fix for one installed release line; `version` is null when no safe fix is known there. */
export interface LineResult {
  /** releaseLine of the installed versions (`9`, `0.4`). */
  line: string;
  version: string | null;
  repos: string[];
}

/**
 * The version to install per installed release line: the highest of the line's
 * resolved fixes that stay on the line and the item's newest release on that line
 * (only when it is newer than every installed version there). A folded item passes
 * every release of its group, so each line gets its own newest one. Fixes and
 * releases on a higher line are never used: no major upgrade in a security command.
 * A line's version is null when it has no on-line candidate, or a fix is unknown and
 * no release on the line covers it: naming one would claim more than we know.
 * An installed version without a semver form has no line: it is its own line (named by the
 * version) without a fix, so the comparable lines keep theirs. Null when there are no repos.
 */
export function lineFixes(
  release: ReleaseVersions,
  repos: readonly RepoFix[]
): LineResult[] | null {
  if (repos.length === 0) return null;
  const releases = stableReleases(release);
  const lines = new Map<string, RepoFix[]>();
  const noLine = new Set<string>();
  for (const r of repos) {
    const installed = semver.valid(r.installed);
    if (!installed) noLine.add(r.installed);
    const line = installed ? releaseLine(installed) : r.installed;
    lines.set(line, [...(lines.get(line) ?? []), { ...r, installed: installed ?? r.installed }]);
  }
  return [...lines.entries()].map(([line, members]) => {
    const repoNames = [...new Set(members.map((m) => m.repo))].sort();
    if (noLine.has(line)) return { line, version: null, repos: repoNames };
    const rel = releases.filter((r) => releaseLine(r) === line).sort(semver.rcompare)[0];
    const releaseOnLine = rel && members.every((m) => semver.gt(rel, m.installed)) ? rel : null;
    const resolved = members.map((m) => stable(m.fix));
    if (!releaseOnLine && resolved.some((f) => f === null)) {
      return { line, version: null, repos: repoNames };
    }
    const onLine = resolved.filter((f): f is string => f !== null && releaseLine(f) === line);
    const candidates = releaseOnLine ? [...onLine, releaseOnLine] : onLine;
    const best = candidates.sort(semver.rcompare)[0] ?? null;
    return { line, version: best, repos: repoNames };
  });
}

function byVersion(results: readonly LineResult[]): LineFix[] {
  const grouped = new Map<string, Set<string>>();
  for (const r of results) {
    if (r.version === null) continue;
    const set = grouped.get(r.version) ?? new Set<string>();
    for (const repo of r.repos) set.add(repo);
    grouped.set(r.version, set);
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => semver.rcompare(a, b))
    .map(([version, set]) => ({ version, repos: [...set].sort() }));
}

/** lineFixes merged per version, or null when any installed line has no safe fix. */
export function recommendFixes(
  release: ReleaseVersions,
  repos: readonly RepoFix[]
): LineFix[] | null {
  const results = lineFixes(release, repos);
  if (!results || results.some((r) => r.version === null)) return null;
  return byVersion(results);
}

/**
 * The versions the fix command installs, newest first (lines without a known fix add
 * none). Repos that have the package only transitively count only when no repo has it
 * directly. The headline guard keeps model headlines to these versions.
 */
export function fixVersions(release: ReleaseVersions, repos: readonly RepoFix[]): string[] {
  const direct = repos.filter((r) => r.direct !== false);
  return byVersion(lineFixes(release, direct.length > 0 ? direct : repos) ?? []).map(
    (f) => f.version
  );
}

/**
 * `npm i pkg@X` when every affected repo lands on one version, else one command per
 * line with its repos: `npm i undici@8.12.2 (budget, pantheon) · npm i undici@7.30.1 (tracker)`.
 * A line without a known fix gets no command, only its repos and the advice to read the
 * advisory (`· 9.x has no known fix, read the advisory: garden`), so the lines that do
 * have one keep their command. Only direct dependencies get a command; repos that have
 * the package only transitively are named after the commands (`· transitive: briff`),
 * which then always list their repos. The bare `npm i pkg@X` is used only when it covers
 * every one of `affectedRepos` too: a matched repo without an alert entry (another line,
 * already past the fix) would otherwise read as covered. Null when no repo has it
 * directly, no line has a safe fix, or it does not fit in 300 characters.
 * The command is the package ecosystem's (installCommand: `composer require x/y:^X` for
 * Packagist).
 */
export function fixCommand(
  pkg: string,
  release: ReleaseVersions,
  repos: readonly RepoFix[],
  transitiveLabel = "transitive",
  affectedRepos: readonly string[] = []
): string | null {
  const direct = repos.filter((r) => r.direct !== false);
  if (direct.length === 0) return null;
  const results = lineFixes(release, direct);
  if (!results) return null;
  const fixes = byVersion(results);
  if (fixes.length === 0) return null;
  const unfixed = results
    .filter((r) => r.version === null)
    .sort((a, b) => b.line.localeCompare(a.line, undefined, { numeric: true }));
  const directRepos = new Set(direct.map((r) => r.repo));
  const transitiveOnly = [
    ...new Set(repos.filter((r) => !directRepos.has(r.repo)).map((r) => r.repo)),
  ].sort();
  const ecosystem = direct.find((r) => r.ecosystem)?.ecosystem;
  const groups = fixes.flatMap((f) =>
    byInstallVariant(f.repos, direct, f.version).map((g) => ({ version: f.version, ...g }))
  );
  const coversAll = groups.length === 1 && affectedRepos.every((r) => groups[0].repos.includes(r));
  const commands =
    coversAll && unfixed.length === 0 && transitiveOnly.length === 0
      ? installCommand(ecosystem, pkg, groups[0].version, groups[0].variant)
      : groups
          .map(
            (g) => `${installCommand(ecosystem, pkg, g.version, g.variant)} (${g.repos.join(", ")})`
          )
          .join(" · ");
  const parts = [
    commands,
    ...unfixed.map((u) => noFixClause(u.line, u.repos)),
    ...(transitiveOnly.length > 0 ? [`${transitiveLabel}: ${transitiveOnly.join(", ")}`] : []),
  ];
  const text = parts.join(" · ");
  return text.length <= COMMAND_MAX ? text : null;
}
