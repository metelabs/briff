import { storedActionTags } from "@/sources/github-actions";
import semver from "semver";

import { lineFixes, releaseLine, type ReleaseVersions, type RepoFix } from "./fixes";
import type { InstallVariant } from "./install-commands";
import {
  affectedRuntimeRepos,
  evidenceRows,
  primaryRow,
  repoAction,
  type RuntimeRow,
} from "./runtime-fixes";
import { runtimeVersionLabel } from "@/lib/runtime-range";
import {
  asEcosystem,
  asPackageManager,
  type Ecosystem,
  type PackageManager,
} from "@scan/ecosystems";
import type { RuntimeItemMeta } from "@/lib/runtime-security";

// What a recommended upgrade means for each repo: the version it runs now next to the
// version the action moves it to ("bakery.example: next 15.2.3 → 16.3.8"). Built from
// the same facts as the action itself (fixes.ts, runtime-fixes.ts), never from its text,
// except for a model-written install command on a release item, whose version is read
// back from the command.

export interface RepoUpgrade {
  repo: string;
  /** Package name or runtime id (`next`, `node`). */
  name: string;
  /** A package's ecosystem when it is not npm (picks the install command); absent for npm and runtimes. */
  ecosystem?: Exclude<Ecosystem, "npm">;
  /** The repo declares the package only for development (`composer require --dev`). */
  dev?: true;
  /** The dependency group of a development-only Python package (`poetry add --group test`). */
  group?: string;
  /** The requirement as the manifest declares it (extras, markers), for the command. */
  requirement?: string;
  /** The uv workspace member that declares it (`uv add --package`). */
  project?: string;
  /** The Python tool this repo installs the package with (`uv lock`, `poetry add`, ...). */
  actionTags?: Record<string, string>;
  manager?: PackageManager;
  /** Installed versions; empty when none is on record ("installed version unknown"). */
  installed: string[];
  /** The version the action moves this repo to; null when it names none for it. */
  target: string | null;
  /** A runtime row: what the repo declares and where (`Dockerfile`). */
  source?: string;
  /** The repo has the package only transitively (no install command of its own). */
  transitive?: boolean;
  /** Matched, but already past the fix or on a line the item does not concern. */
  unaffected?: boolean;
  /**
   * This repo's own derived action, without the repo name (runtime items: `move Dockerfile
   * to node:22.23.4-alpine`), kept even when the item's action was shortened to a summary
   * ("Update Node.js to 22.23.4 in 12 repos"). Bulletins before this field have none.
   */
  action?: string;
}

function sortVersions(versions: Iterable<string>): string[] {
  return [...new Set(versions)].sort((a, b) => {
    const va = semver.valid(a);
    const vb = semver.valid(b);
    return va && vb ? semver.compare(va, vb) : a.localeCompare(b);
  });
}

/** An installed version of a package in one repo (Dependency row). */
export interface RepoInstall {
  version: string;
  direct: boolean;
  /** The package's ecosystem when it is not npm (one name can be two packages). */
  ecosystem?: string;
  dev?: boolean;
  group?: string;
  requirement?: string;
  project?: string;
  actionTags?: Record<string, string>;
  manager?: PackageManager;
}

/**
 * Per affected repo of a security package: its affected installed versions and the fix
 * for its release line (lineFixes, the same call fixCommand makes: a line without a safe fix
 * gets no target, the other lines keep theirs). Repos that only
 * have the package transitively get no target. `otherRepos` (affected repos without an
 * alert entry) are listed with the versions `installedOf` has on record, without a target,
 * or as "installed version unknown"; never dropped.
 */
export function packageUpgrades(
  pkg: string,
  release: ReleaseVersions,
  repoFixes: readonly RepoFix[],
  otherRepos: readonly string[] = [],
  installedOf: (repo: string) => readonly RepoInstall[] = () => []
): RepoUpgrade[] {
  const direct = repoFixes.filter((r) => r.direct !== false);
  const lines = direct.length > 0 ? lineFixes(release, direct) : null;
  const ecosystem = repoFixes.find((r) => r.ecosystem)?.ecosystem;
  const ecosystemField = ecosystem && ecosystem !== "npm" ? { ecosystem } : {};
  // One entry per repo and release line: a repo on two lines gets both targets, and a version
  // it has only transitively gets its own entry without one.
  const entries = new Map<string, RepoUpgrade & { versions: Set<string> }>();
  /** How one installed version is declared; a repo with two declarations gets two lines. */
  type Declared = Pick<
    RepoFix,
    "dev" | "group" | "requirement" | "project" | "manager" | "actionTags"
  >;
  const declaredKey = (d: Declared) =>
    JSON.stringify([d.dev === true, d.group, d.requirement, d.project, d.manager]);
  const add = (
    repo: string,
    key: string,
    version: string | null,
    base: Omit<RepoUpgrade, "repo" | "name" | "installed">,
    declared: Declared = {}
  ) => {
    // One line per repo, release line and declaration: two pins of one line declared per
    // platform each get their own command (upgradeActions).
    const id = `${repo}\u0000${key}\u0000${declaredKey(declared)}`;
    const entry = entries.get(id) ?? {
      repo,
      name: pkg,
      ...ecosystemField,
      ...(declared.dev ? { dev: true as const } : {}),
      ...(declared.group ? { group: declared.group } : {}),
      ...(declared.actionTags ? { actionTags: declared.actionTags } : {}),
      ...(declared.requirement ? { requirement: declared.requirement } : {}),
      ...(declared.project ? { project: declared.project } : {}),
      ...(declared.manager ? { manager: declared.manager } : {}),
      installed: [],
      versions: new Set<string>(),
      ...base,
    };
    if (version) entry.versions.add(version);
    entries.set(id, entry);
  };
  for (const r of repoFixes) {
    if (r.direct === false) {
      add(r.repo, "transitive", r.installed, { target: null, transitive: true }, r);
      continue;
    }
    const valid = semver.valid(r.installed);
    const line = valid ? releaseLine(valid) : r.installed;
    const target = valid
      ? lines?.find((l) => l.line === line && l.repos.includes(r.repo))?.version
      : null;
    add(r.repo, `line:${line}`, r.installed, { target: target ?? null }, r);
  }
  for (const repo of otherRepos) {
    if ([...entries.values()].some((e) => e.repo === repo)) continue;
    const installs = installedOf(repo);
    if (installs.length === 0) add(repo, "unknown", null, { target: null });
    for (const i of installs) {
      if (i.direct) add(repo, "installed", i.version, { target: null }, i);
      else add(repo, "transitive", i.version, { target: null, transitive: true }, i);
    }
  }
  return [...entries.values()]
    .map(({ versions, ...u }) => ({ ...u, installed: sortVersions(versions) }))
    .sort(
      (a, b) =>
        a.repo.localeCompare(b.repo) ||
        Number(Boolean(a.transitive)) - Number(Boolean(b.transitive)) ||
        (a.installed[0] ?? "").localeCompare(b.installed[0] ?? "")
    );
}

/**
 * Per affected repo of a runtime security item: the row its action is about (an image
 * row first), and the fixed version for its line; for a line without a fix, the version
 * the action names instead (nearest on the major, or the supported line after EOL).
 */
export function runtimeUpgrades(
  runtime: string,
  meta: Pick<RuntimeItemMeta, "fixedVersions" | "lineSpecific" | "affectedLines">,
  rows: readonly RuntimeRow[],
  asOf: Date = new Date(),
  /** Every matched repo: the ones without an action are named too (not affected, or unknown). */
  repos: readonly string[] = []
): RepoUpgrade[] {
  const affected = affectedRuntimeRepos(runtime, meta, rows, asOf).map((entry): RepoUpgrade => {
    const { repo, row, status } = entry;
    // Same sentence as the item's per-repo clause (runtimeRepoActions): only once fixed
    // versions are known, or for an end-of-life line, which never gets one.
    const action =
      meta.fixedVersions.length > 0 || status.kind === "eol"
        ? repoAction(runtime, entry, meta.fixedVersions).replace(`${repo}: `, "")
        : "";
    return {
      repo,
      name: runtime,
      installed: row.unresolved ? [] : [runtimeVersionLabel(row)],
      source: row.source,
      target:
        status.kind === "fix"
          ? status.version
          : status.kind === "unsupported"
            ? status.nearest
            : status.kind === "eol"
              ? status.target
              : null,
      ...(action ? { action } : {}),
    };
  });
  const covered = new Set(affected.map((u) => u.repo));
  const others = [...new Set(repos)]
    .filter((repo) => !covered.has(repo))
    .map((repo): RepoUpgrade => {
      const row = primaryRow(
        evidenceRows(rows.filter((r) => r.repo === repo && r.name === runtime))
      );
      if (!row) return { repo, name: runtime, installed: [], target: null };
      return {
        repo,
        name: runtime,
        installed: row.unresolved ? [] : [runtimeVersionLabel(row)],
        source: row.source,
        target: null,
        unaffected: true,
      };
    });
  return [...affected, ...others].sort((a, b) => a.repo.localeCompare(b.repo));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Versions an action installs for `pkg`, per repo when the command lists them:
 * `npm i next@16.3.8` → every repo; `npm i x@2.1.0 (a, b) · npm i x@1.9.3 (c)` → per repo.
 * Null when the action installs no version of `pkg`.
 */
export function installTargets(
  action: string,
  pkg: string
): { all: string | null; byRepo: Map<string, string> } | null {
  // `pkg@1.2.3` (npm, Poetry, Go `@v1.2.3`), `pkg:^1.2.3` (Composer), `pkg==1.2.3` (pip, uv).
  const re = new RegExp(
    `(?<![\\w@/.-])${escapeRegExp(pkg)}(?:@v?|:\\^?v?|==)(\\d+\\.\\d+\\.\\d+[\\w.+-]*)(?:\\s+\\(([^()]+)\\))?`,
    "g"
  );
  const byRepo = new Map<string, string>();
  let all: string | null = null;
  let found = false;
  for (const m of action.matchAll(re)) {
    found = true;
    if (m[2]) for (const repo of m[2].split(",")) byRepo.set(repo.trim(), m[1]);
    else all ??= m[1];
  }
  return found ? { all, byRepo } : null;
}

/**
 * Per affected repo and installed release line of a release item whose action recommends an
 * upgrade. Only versions that were in the synthesis input count (`releases`: the item's own
 * and its folded releases): the install command's version when it is one of them, else the
 * newest of them on the installed line that is newer than what is installed. Never a release
 * on another line by default, and no target at all when there is none (the installed
 * version is still listed). A repo without a version on record keeps the command's version
 * only.
 */
export function releaseUpgrades(
  pkg: string,
  action: string,
  releases: readonly string[],
  repos: readonly string[],
  installedOf: (repo: string) => readonly string[],
  ecosystem?: Exclude<Ecosystem, "npm">,
  /** How the repo declares one installed version (undefined: the repo has none on record). */
  variantOf: (repo: string, version: string | undefined) => InstallVariant = () => ({})
): RepoUpgrade[] {
  const named = (variant: InstallVariant) => {
    const { dev, manager, group, requirement, project } = variant;
    return {
      name: pkg,
      ...(ecosystem ? { ecosystem } : {}),
      ...(dev ? { dev: true as const } : {}),
      ...(group ? { group } : {}),
      ...(requirement ? { requirement } : {}),
      ...(project ? { project } : {}),
      ...(manager ? { manager } : {}),
    };
  };
  const known = releases.flatMap((r) => semver.valid(r) ?? []);
  const allowed = new Set(known);
  const targets = installTargets(action, pkg);
  const commanded = (repo: string): string | null => {
    const v = targets ? (targets.byRepo.get(repo) ?? targets.all) : null;
    const valid = v ? semver.valid(v) : null;
    // A version the model wrote but the input never had is not a recommendation.
    return valid && allowed.has(valid) ? valid : null;
  };
  const onLine = (installed: string): string | null =>
    known
      .filter((r) => releaseLine(r) === releaseLine(installed) && semver.gt(r, installed))
      .sort(semver.rcompare)[0] ?? null;

  const out: RepoUpgrade[] = [];
  for (const repo of [...new Set(repos)].sort()) {
    const command = commanded(repo);
    const installed = sortVersions(installedOf(repo));
    if (installed.length === 0) {
      out.push({ repo, ...named(variantOf(repo, undefined)), installed: [], target: command });
      continue;
    }
    // One line per release line and declaration: each installed version keeps its own
    // declaration (a `test` pin of 1.x and a main pin of 2.x are two edits).
    const byLine = new Map<string, { variant: InstallVariant; versions: string[] }>();
    for (const v of installed) {
      const valid = semver.valid(v);
      const line = valid ? releaseLine(valid) : v;
      const variant = variantOf(repo, v);
      const key = `${line}\u0000${JSON.stringify(variant)}`;
      const entry = byLine.get(key) ?? { variant, versions: [] };
      entry.versions.push(v);
      byLine.set(key, entry);
    }
    for (const { variant, versions } of byLine.values()) {
      const newest = versions.flatMap((v) => semver.valid(v) ?? []).sort(semver.rcompare)[0];
      const target = command ?? (newest ? onLine(newest) : null);
      out.push({ repo, ...named(variant), installed: versions, target });
    }
  }
  return out;
}

/**
 * Upgrade lines for exactly the item's affected repos (BulletinItem.affectedRepos is the one
 * source of truth for which repos an item concerns): lines of other repos are dropped, and an
 * affected repo without a line gets "installed version unknown". Empty stays empty: an item
 * whose action recommends no version has no lines at all.
 */
export function alignUpgrades(
  upgrades: readonly RepoUpgrade[],
  affectedRepos: readonly string[]
): RepoUpgrade[] {
  if (upgrades.length === 0) return [];
  const repos = new Set(affectedRepos);
  const kept = upgrades.filter((u) => repos.has(u.repo));
  const { name, ecosystem } = upgrades[0];
  const missing = [...repos]
    .filter((repo) => !kept.some((u) => u.repo === repo))
    .map((repo): RepoUpgrade => ({
      repo,
      name,
      ...(ecosystem ? { ecosystem } : {}),
      installed: [],
      target: null,
    }));
  return [...kept, ...missing].sort((a, b) => a.repo.localeCompare(b.repo));
}

/** Upgrade lines of `repo`, in their order. */
export function upgradesFor(upgrades: readonly RepoUpgrade[], repo: string): RepoUpgrade[] {
  return upgrades.filter((u) => u.repo === repo);
}

const UNKNOWN = "installed version unknown";

/**
 * The installed side of a line, without the repo: `next 15.2.3`, `node 22.17.0
 * (Dockerfile)`, `next installed version unknown`.
 */
export function installedText(u: RepoUpgrade): string {
  const versions = u.installed.length > 0 ? u.installed.join(", ") : UNKNOWN;
  const source = u.source ? ` (${u.source})` : "";
  const transitive = u.transitive ? " (transitive)" : "";
  const unaffected = u.unaffected ? ", not affected" : "";
  return `${u.name} ${versions}${source}${transitive}${unaffected}`;
}

/**
 * One line per repo: `bakery.example: next 15.2.3 → 16.3.8`, `garden.example runs node
 * 22.17.0 (Dockerfile) → 22.23.4`, `briff: next installed version unknown → 16.3.8`.
 */
export function upgradeLine(u: RepoUpgrade): string {
  const head = u.source ? `${u.repo} runs ` : `${u.repo}: `;
  return `${head}${installedText(u)}${u.target ? ` → ${u.target}` : ""}`;
}

/** Defensive read of the stored JSON (BulletinItem.upgrades); malformed entries are dropped. */
function nonNpm(value: unknown): Exclude<Ecosystem, "npm"> | undefined {
  const ecosystem = typeof value === "string" ? asEcosystem(value) : undefined;
  return ecosystem === "npm" ? undefined : ecosystem;
}

export function parseUpgrades(value: unknown): RepoUpgrade[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v): RepoUpgrade[] => {
    if (!v || typeof v !== "object") return [];
    const o = v as Record<string, unknown>;
    if (typeof o.repo !== "string" || typeof o.name !== "string") return [];
    const installed = Array.isArray(o.installed)
      ? o.installed.filter((i): i is string => typeof i === "string")
      : [];
    return [
      {
        repo: o.repo,
        name: o.name,
        ...(nonNpm(o.ecosystem) ? { ecosystem: nonNpm(o.ecosystem) } : {}),
        ...(o.dev === true ? { dev: true as const } : {}),
        ...(typeof o.group === "string" && o.group ? { group: o.group } : {}),
        ...(typeof o.requirement === "string" && o.requirement
          ? { requirement: o.requirement }
          : {}),
        ...(typeof o.project === "string" && o.project ? { project: o.project } : {}),
        ...(typeof o.manager === "string" && asPackageManager(o.manager)
          ? { manager: asPackageManager(o.manager) }
          : {}),
        ...(storedActionTags(o.actionTags) ? { actionTags: storedActionTags(o.actionTags) } : {}),
        installed,
        target: typeof o.target === "string" ? o.target : null,
        ...(typeof o.source === "string" ? { source: o.source } : {}),
        ...(o.transitive === true ? { transitive: true } : {}),
        ...(o.unaffected === true ? { unaffected: true } : {}),
        ...(typeof o.action === "string" && o.action ? { action: o.action } : {}),
      },
    ];
  });
}
