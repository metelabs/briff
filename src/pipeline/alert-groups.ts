import semver from "semver";

import { severityLabel, severityRank } from "@/security/plan";
import { affectedInstalls, fixedVersionFor, type OsvRange } from "@/sources/osv";

import { declarationOf, mergeFixedLists, type AlertRow } from "./bulletin-view";
import { asEcosystem, type Ecosystem, type PackageManager } from "@scan/ecosystems";

import { byInstallVariant, recommendFixes, releaseLine, type RepoFix } from "./fixes";
import { installCommand, whyCommand } from "./install-commands";
import type { RepoUpgrade } from "./upgrades";

// The Alerts page: one group per package with every advisory behind it, and the fix per
// repo under the same rules as the bulletin page's alert lines (bulletin-view.ts
// fixFor): one install per installed release line (recommendFixes), never a higher
// major; no on-line fix -> the "no fix on the installed release line" sentence; repos
// that only have the package transitively get `npm ls <pkg>` (the act_transitive advice).
// Commands are the package ecosystem's (install-commands.ts: `composer require`, `composer why`).

export interface AlertGroupAdvisory {
  osvId: string;
  severity: string | null;
  summary: string | null;
  /** The vulnerability's other OSV records (GO-*, PYSEC-*), merged into this one. */
  aliases: string[];
}

export interface AlertFixLine {
  repos: string[];
  /** A command to copy (`npm i pkg@X`, `npm ls pkg`). */
  command: string | null;
  /** A sentence instead of, or before, the command. */
  text: string | null;
  /** One entry per repo of the line: installed version(s) -> the version the command installs. */
  installs: RepoUpgrade[];
}

export interface AlertPackageGroup {
  packageName: string;
  /** The package's ecosystem when it is not npm (shown as a tag, picks the commands). */
  ecosystem?: Exclude<Ecosystem, "npm">;
  /** At least one affected repo has the package as a direct dependency. */
  direct: boolean;
  /** Advisory count per severity label, most severe first: [["CRITICAL", 1], ["HIGH", 3]]. */
  severities: [string, number][];
  advisories: AlertGroupAdvisory[];
  repos: string[];
  fixes: AlertFixLine[];
}

export interface AlertGroupRow extends AlertRow {
  advisory: AlertRow["advisory"] & { summary?: string | null; aliases?: unknown };
  /**
   * Installed versions the repo has as a direct dependency (attachInstalls). Absent: all of
   * `installedVersions` when `direct`, none otherwise.
   */
  directVersions?: readonly string[];
}

export interface FixWording {
  noLineFix: string;
  fixedIn: string;
  transitive: string;
}

// Ecosystem databases OSV merges records from; their ids are the duplicates a reader saw.
const OSV_DATABASE_ID = /^(GHSA|GO|PYSEC|RUSTSEC|GMS)-/;

/** The aliases named next to the id (GO-*, PYSEC-*); CVE and vendor ids stay on osv.dev. */
function shownAliases(aliases: unknown): string[] {
  if (!Array.isArray(aliases)) return [];
  return aliases.filter((a): a is string => typeof a === "string" && OSV_DATABASE_ID.test(a));
}

function sameLine(a: string, b: string): boolean {
  const va = semver.valid(a);
  const vb = semver.valid(b);
  return !va || !vb || releaseLine(va) === releaseLine(vb);
}

/** The one Python tool every entry uses, else undefined (the generic command then). */
function sharedManager(fixes: readonly RepoFix[]): PackageManager | undefined {
  const managers = new Set(fixes.map((f) => f.manager));
  return managers.size === 1 ? [...managers][0] : undefined;
}

function installsOf(
  pkg: string,
  repos: readonly string[],
  repoFixes: readonly RepoFix[],
  target: string | null,
  transitive = false
): RepoUpgrade[] {
  return repos.map((repo) => ({
    repo,
    name: pkg,
    // A repo on two release lines shows on each line only its version there.
    installed: [
      ...new Set(
        repoFixes
          .filter((f) => f.repo === repo && (!target || sameLine(f.installed, target)))
          .map((f) => f.installed)
      ),
    ],
    target,
    ...(transitive ? { transitive: true } : {}),
  }));
}

function directFixes(
  pkg: string,
  ecosystem: Ecosystem | undefined,
  repos: readonly string[],
  repoFixes: readonly RepoFix[],
  unknownRepos: readonly string[],
  fallbacks: readonly (string | null)[],
  installedKnown: boolean,
  wording: FixWording
): AlertFixLine[] {
  if (repos.length === 0) return [];
  // Installed versions known and none affected any more: nothing to install.
  if (repoFixes.length === 0 && installedKnown) {
    return unknownRepos.length > 0
      ? [
          {
            repos: [...unknownRepos],
            command: null,
            text: null,
            installs: installsOf(pkg, unknownRepos, [], null),
          },
        ]
      : [];
  }
  if (repoFixes.length === 0) {
    const merged = mergeFixedLists(fallbacks);
    return merged
      ? [
          {
            repos: [...repos],
            command: null,
            text: `${wording.fixedIn} ${merged}`,
            installs: installsOf(pkg, repos, [], null),
          },
        ]
      : [];
  }
  const lines = recommendFixes(null, repoFixes);
  if (!lines) {
    return [
      {
        repos: [...repos],
        command: null,
        text: wording.noLineFix,
        installs: installsOf(pkg, repos, repoFixes, null),
      },
    ];
  }
  // One command per install variant on a line: `composer require` next to `composer require
  // --dev`, `uv lock` next to `poetry add`.
  const fixed = lines.flatMap((l) =>
    byInstallVariant(l.repos, repoFixes, l.version).map((g) => ({
      repos: g.repos,
      command: installCommand(ecosystem, pkg, l.version, g.variant),
      text: null,
      installs: installsOf(pkg, g.repos, repoFixes, l.version),
    }))
  );
  // Repos without an installed version on record are named, not dropped.
  const unknown = unknownRepos.filter((r) => !lines.some((l) => l.repos.includes(r)));
  return unknown.length > 0
    ? [
        ...fixed,
        { repos: unknown, command: null, text: null, installs: installsOf(pkg, unknown, [], null) },
      ]
    : fixed;
}

/**
 * Groups alert rows per package. Within a package, a repo counts as direct when any of
 * its rows is direct; the rest are transitive and share one `npm ls` line.
 * Sorted by the most severe advisory, then advisory count, then name.
 */
export function alertGroupsOf(
  rows: readonly AlertGroupRow[],
  wording: FixWording
): AlertPackageGroup[] {
  interface Acc {
    packageName: string;
    ecosystem: Ecosystem | undefined;
    advisories: Map<string, AlertGroupAdvisory & { fallback: string | null }>;
    directRepos: Set<string>;
    allRepos: Set<string>;
    repoFixes: RepoFix[];
    /** Affected versions repos have only transitively (shown on the `npm ls` line). */
    transitiveFixes: RepoFix[];
    unknownRepos: Set<string>;
    installedKnown: boolean;
  }
  const groups = new Map<string, Acc>();
  for (const r of rows) {
    const pkg = r.advisory.package.name;
    const ecosystem = asEcosystem(r.advisory.package.ecosystem);
    // (ecosystem, name) is the package: an npm and a PyPI package of one name are two groups.
    const key = `${ecosystem ?? "npm"}\0${pkg}`;
    const g: Acc = groups.get(key) ?? {
      packageName: pkg,
      ecosystem,
      advisories: new Map(),
      directRepos: new Set(),
      allRepos: new Set(),
      repoFixes: [],
      transitiveFixes: [],
      unknownRepos: new Set(),
      installedKnown: false,
    };
    g.advisories.set(r.advisory.osvId, {
      osvId: r.advisory.osvId,
      severity: r.advisory.severity,
      summary: r.advisory.summary ?? null,
      aliases: shownAliases(r.advisory.aliases),
      fallback: r.advisory.fixedVersion,
    });
    g.allRepos.add(r.repo.name);
    const ranges = r.advisory.affected as OsvRange[];
    if (r.installedVersions.length === 0) {
      // No dependency row: the relation is unknown and treated as direct, without a fix.
      if (r.direct) {
        g.directRepos.add(r.repo.name);
        g.unknownRepos.add(r.repo.name);
      }
    } else {
      // A repo can have one version directly and another transitively: only the direct,
      // affected versions get an install command; an affected transitive one gets npm ls.
      const directSet = new Set(r.directVersions ?? (r.direct ? r.installedVersions : []));
      const affectedDirect = affectedInstalls(
        ranges,
        r.installedVersions.filter((v) => directSet.has(v)),
        (v) => v
      );
      const affectedAny = affectedInstalls(ranges, r.installedVersions, (v) => v);
      if (affectedDirect.length > 0) {
        g.directRepos.add(r.repo.name);
        g.installedKnown = true;
        for (const installed of affectedDirect) {
          g.repoFixes.push({
            repo: r.repo.name,
            installed,
            fix: fixedVersionFor(ranges, installed),
            ...declarationOf(r, installed),
          });
        }
      } else if (affectedAny.length === 0 && directSet.size > 0) {
        // Directly installed and already past the fix: nothing to install.
        g.directRepos.add(r.repo.name);
        g.installedKnown = true;
      }
    }
    if (r.installedVersions.length > 0) {
      // What the `npm ls` line shows for a repo without the package directly: the affected
      // versions, else whatever is installed.
      const affectedAll = affectedInstalls(ranges, r.installedVersions, (v) => v);
      for (const installed of affectedAll.length > 0 ? affectedAll : r.installedVersions) {
        g.transitiveFixes.push({
          repo: r.repo.name,
          installed,
          fix: null,
          direct: false,
          ...(r.manager ? { manager: r.manager } : {}),
        });
      }
    }
    groups.set(key, g);
  }

  return [...groups.values()]
    .map((g) => {
      const { packageName } = g;
      const advisories = [...g.advisories.values()].sort(
        (a, b) =>
          severityRank(b.severity) - severityRank(a.severity) || a.osvId.localeCompare(b.osvId)
      );
      const severities = new Map<string, number>();
      for (const a of advisories) {
        const label = severityLabel(a.severity);
        severities.set(label, (severities.get(label) ?? 0) + 1);
      }
      const direct = [...g.directRepos].sort();
      const transitive = [...g.allRepos].filter((r) => !g.directRepos.has(r)).sort();
      const fixes = [
        ...directFixes(
          packageName,
          g.ecosystem,
          direct,
          g.repoFixes,
          [...g.unknownRepos].sort(),
          advisories.map((a) => a.fallback),
          g.installedKnown,
          wording
        ),
        ...(transitive.length > 0
          ? [
              {
                repos: transitive,
                command: whyCommand(
                  g.ecosystem,
                  packageName,
                  sharedManager(g.transitiveFixes.filter((f) => transitive.includes(f.repo)))
                ),
                text: wording.transitive,
                installs: installsOf(packageName, transitive, g.transitiveFixes, null, true),
              },
            ]
          : []),
      ];
      return {
        packageName,
        ...(g.ecosystem && g.ecosystem !== "npm" ? { ecosystem: g.ecosystem } : {}),
        direct: direct.length > 0,
        severities: [...severities.entries()],
        advisories: advisories.map(({ osvId, severity, summary, aliases }) => ({
          osvId,
          severity,
          summary,
          aliases,
        })),
        repos: [...g.allRepos].sort(),
        fixes,
      };
    })
    .sort(
      (a, b) =>
        severityRank(b.advisories[0].severity) - severityRank(a.advisories[0].severity) ||
        b.advisories.length - a.advisories.length ||
        a.packageName.localeCompare(b.packageName)
    );
}

/** Advisory counts per severity label across groups (filter chip counts). */
export function severityTotals(groups: readonly AlertPackageGroup[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const g of groups) {
    for (const [label, n] of g.severities) totals.set(label, (totals.get(label) ?? 0) + n);
  }
  return totals;
}
