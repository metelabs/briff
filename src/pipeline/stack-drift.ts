import semver from "semver";

import { lineFacts, lineLifecycle, lowestSupportedLineAbove } from "@/lib/runtime-eol";
import { runtimeVersionLabel } from "@/lib/runtime-range";
import { compareDotted, isExactVersion, releaseLineOf, runtimeName } from "@/lib/runtime-security";
import { stackPackageKey } from "@/lib/match/matcher";
import { ecosystemLabel } from "@scan/ecosystems";
import { isConstraintRow, runtimeEvidence } from "@scan/runtimes";

import { releaseLine } from "./fixes";

// The Stack page: one card per repo with one entry per runtime it declares and per key
// package (the direct packages most repos share). Runtimes are judged against the
// lifecycle table (src/lib/runtime-eol.ts), packages against Package.latestVersion
// (refresh-packages: npm "latest" dist-tag, newest stable Packagist release). A target
// never crosses the installed release line, except the end-of-life migration sentence,
// which names the lowest supported line.

/**
 * `eol` past end of life; `supported` a runtime on a supported line; `current` a package at
 * its latest; `minor` behind on the installed line; `major` a package lines behind;
 * `unknown` not judged (no data, a range, a build variable).
 */
export type EntryStatus = "eol" | "supported" | "current" | "minor" | "major" | "unknown";

export interface StackEntry {
  key: string;
  kind: "runtime" | "package";
  /** `Node.js`, `next`. */
  label: string;
  /** Packages only, when key packages span more than one ecosystem (`npm`, `Composer`). */
  ecosystem?: string;
  version: string | null;
  /** Where a runtime version comes from: `Dockerfile`, `.nvmrc +1`. */
  source: string | null;
  status: EntryStatus;
  /** End-of-life date (`eol`) or end of support (`supported`, runtime `minor`). */
  until: string | null;
  /** Release lines behind the latest (`major` only). */
  behind: number;
  /** What to move to: "Move to 22.x (LTS, supported until 2027-04)", "Latest in your line: 20.19.4". */
  target: string | null;
  /** Why an entry is not judged. */
  note: string | null;
}

/** 3 end of life, 2 majors behind, 1 minor behind, 0 current or not judged. */
export type Urgency = 0 | 1 | 2 | 3;

export interface StackRepo {
  /** The input key (the repo id in the app): names are unique per source only. */
  key: string;
  repo: string;
  entries: StackEntry[];
  urgency: Urgency;
  eolCount: number;
  /** Release lines behind, summed over the repo's package entries. */
  majorsBehind: number;
  eol: boolean;
  drift: boolean;
}

export interface DriftRuntimeRow {
  /** The repo's key in `computeDrift`'s `repos`. */
  repo: string;
  name: string;
  version: string;
  normalized: string | null;
  source: string;
  image: string | null;
  unresolved?: boolean;
  /** A constraint (`engines.node >=20`); derived when absent. */
  constraint?: boolean | null;
}

export interface DriftDependency {
  /** The repo's key in `computeDrift`'s `repos`. */
  repo: string;
  /** `Package.ecosystem`; npm when absent. */
  ecosystem?: string;
  packageName: string;
  installedVersion: string;
  latestVersion: string | null;
  /** `installedVersion` is a requirement (`>=2.0`), not an install: shown, never judged. */
  unresolved?: boolean;
}

export const STACK_PACKAGE_COLUMNS = 6;

type Judged = Pick<StackEntry, "version" | "status" | "until" | "behind" | "target" | "note">;

const MONTH = (date: string) => date.slice(0, 7);

/**
 * The end-of-life sentence: the lowest supported line above the installed one, worded as a
 * migration (never a command), with its LTS flag and end of support when the table knows them.
 */
export function eolTarget(runtime: string, line: string, asOf: Date): string {
  const next = lowestSupportedLineAbove(runtime, line, asOf);
  if (!next) return "Move to a supported release line";
  const facts = lineFacts(runtime, next, asOf);
  const detail = [
    facts?.lts ? "LTS" : null,
    facts?.eolDate ? `supported until ${MONTH(facts.eolDate)}` : null,
  ].filter(Boolean);
  return `Move to ${next}.x${detail.length ? ` (${detail.join(", ")})` : ""}`;
}

/** One runtime version against the lifecycle table: status, dates and what to move to. */
export function judgeRuntime(
  runtime: string,
  row: {
    version: string;
    normalized: string | null;
    source: string;
    unresolved?: boolean;
    constraint?: boolean | null;
  },
  asOf: Date
): Omit<Judged, "version"> {
  const base = { until: null, behind: 0, target: null };
  if (row.unresolved) {
    return { ...base, status: "unknown", note: "Version comes from a build variable" };
  }
  if (isConstraintRow({ ...row, unresolved: false })) {
    return { ...base, status: "unknown", note: "A version range, not the version that runs" };
  }
  const version = row.normalized ?? row.version;
  const line = releaseLineOf(runtime, version);
  if (line === null) return { ...base, status: "unknown", note: "No release line in the version" };
  const lifecycle = lineLifecycle(runtime, line, asOf);
  const facts = lineFacts(runtime, line, asOf);
  if (lifecycle === "eol") {
    return {
      ...base,
      status: "eol",
      until: facts?.eolDate ?? null,
      target: eolTarget(runtime, line, asOf),
      note: null,
    };
  }
  if (lifecycle === "unknown" || !facts) {
    return { ...base, status: "unknown", note: "No lifecycle data for this line" };
  }
  // The table can file a line under its major (bun `1.2` under cycle `1`): its latest is
  // only a target when it is on the installed line.
  const latest =
    facts.latest !== null && releaseLineOf(runtime, facts.latest) === line ? facts.latest : null;
  const exact = isExactVersion(runtime, version);
  const behind = latest !== null && exact && compareDotted(version, latest) < 0;
  return {
    ...base,
    status: behind ? "minor" : "supported",
    until: facts.eolDate,
    target:
      latest && (behind || !exact)
        ? `Latest in your line: ${latest}${behind && facts.eolDate ? ` (line supported until ${MONTH(facts.eolDate)})` : ""}`
        : null,
    note: null,
  };
}

function runtimeEntry(rows: readonly DriftRuntimeRow[], asOf: Date): Judged & { source: string } {
  // Concrete rows speak for the repo when it has any; a constraint is never end-of-life
  // (`engines.node >=20` allows 22), and a workspace package's never outweighs the root's.
  const evidence = runtimeEvidence(rows.map((r) => ({ ...r, unresolved: r.unresolved ?? false })));
  const judged = evidence.map((r) => ({
    row: r,
    shown: runtimeVersionLabel(r),
    ...judgeRuntime(r.name, r, asOf),
  }));
  // The worst row speaks for the repo: an end-of-life line anywhere, else the image row
  // (what actually runs), else the first file.
  judged.sort(
    (a, b) =>
      Number(b.status === "eol") - Number(a.status === "eol") ||
      Number(b.row.image !== null) - Number(a.row.image !== null) ||
      a.row.source.localeCompare(b.row.source)
  );
  const { row, shown, ...pick } = judged[0];
  const files = [...new Set(rows.map((r) => r.source))];
  return {
    ...pick,
    version: shown,
    source: files.length > 1 ? `${row.source} +${files.length - 1}` : row.source,
  };
}

/** Behind count between two versions on different lines: majors, or minors below 1.0. */
function linesBehind(installed: semver.SemVer, latest: semver.SemVer): number {
  if (latest.major !== installed.major) return Math.max(1, latest.major - installed.major);
  return Math.max(1, latest.minor - installed.minor);
}

/** Exact lockfile versions keep their prerelease tag; only loose text is coerced. */
function toSemver(version: string): semver.SemVer | null {
  return semver.parse(version.trim().replace(/^v/, "")) ?? semver.coerce(version);
}

/** The lowest installed version against the registry's latest. Null without any install. */
export function packageEntry(
  installedVersions: readonly string[],
  latest: string | null
): Judged | null {
  const parsed = installedVersions
    .map((raw) => ({ raw, sem: toSemver(raw) }))
    .sort((a, b) => (a.sem && b.sem ? semver.compare(a.sem, b.sem) : a.sem ? -1 : 1));
  const lowest = parsed[0];
  if (!lowest) return null;
  const latestSem = latest ? toSemver(latest) : null;
  const base = { version: lowest.raw, until: null, behind: 0, target: null, note: null };
  if (!lowest.sem) return { ...base, status: "unknown", note: "Version not comparable" };
  if (!latestSem) return { ...base, status: "unknown", note: "No registry data yet" };
  if (semver.gte(lowest.sem, latestSem)) return { ...base, status: "current" };
  if (releaseLine(lowest.sem.version) === releaseLine(latestSem.version)) {
    return { ...base, status: "minor", target: `Latest in your line: ${latest}` };
  }
  // Only the registry's latest is stored, so there is no on-line target; the newer line is
  // named as information, never as the step to take.
  return {
    ...base,
    status: "major",
    behind: linesBehind(lowest.sem, latestSem),
    target: `Newest release ${latest} is a major upgrade`,
  };
}

interface PackageColumn {
  key: string;
  label: string;
  ecosystem?: string;
  latest: string | null;
}

function keyPackages(
  packages: ReadonlyMap<
    string,
    { name: string; ecosystem: string; repos: Set<string>; latest: string | null }
  >,
  limit: number
): PackageColumn[] {
  const top = [...packages.entries()]
    .map(([key, e]) => ({ key, ...e, count: e.repos.size }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
  const mixed = new Set(top.map((p) => p.ecosystem)).size > 1;
  return top.map((p) => ({
    key: p.key,
    label: p.name,
    latest: p.latest,
    ...(mixed || p.ecosystem === "GitHub Actions"
      ? { ecosystem: ecosystemLabel(p.ecosystem) }
      : {}),
  }));
}

const ENTRY_URGENCY: Record<EntryStatus, Urgency> = {
  eol: 3,
  major: 2,
  minor: 1,
  supported: 0,
  current: 0,
  unknown: 0,
};

/** The worst entry's urgency: end of life > majors behind > minor behind > current. */
export function repoUrgency(entries: readonly Pick<StackEntry, "status">[]): Urgency {
  return entries.reduce<Urgency>((u, e) => Math.max(u, ENTRY_URGENCY[e.status]) as Urgency, 0);
}

/** Most urgent first; then more end-of-life entries, more majors behind, then name. */
export function compareStackRepos(a: StackRepo, b: StackRepo): number {
  return (
    b.urgency - a.urgency ||
    b.eolCount - a.eolCount ||
    b.majorsBehind - a.majorsBehind ||
    a.repo.localeCompare(b.repo)
  );
}

/**
 * One card per repo: every runtime it declares (most used across repos first), then the key
 * packages it uses. Only what the repo has; an absent runtime or package is no entry.
 */
export function computeDrift(input: {
  repos: readonly { key: string; name: string }[];
  runtimes: readonly DriftRuntimeRow[];
  dependencies: readonly DriftDependency[];
  asOf: Date;
  packageColumns?: number;
}): StackRepo[] {
  const runtimes = input.runtimes.filter((r) => r.name !== "image");
  const runtimeRepos = new Map<string, Set<string>>();
  for (const r of runtimes) {
    runtimeRepos.set(r.name, (runtimeRepos.get(r.name) ?? new Set()).add(r.repo));
  }
  const packageRepos = new Map<
    string,
    { name: string; ecosystem: string; repos: Set<string>; latest: string | null }
  >();
  for (const d of input.dependencies) {
    const ecosystem = d.ecosystem ?? "npm";
    // Type packages follow their library; an entry for them says nothing new.
    if (ecosystem === "npm" && d.packageName.startsWith("@types/")) continue;
    const key = stackPackageKey(ecosystem, d.packageName);
    const entry = packageRepos.get(key) ?? {
      name: d.packageName,
      ecosystem,
      repos: new Set(),
      latest: d.latestVersion,
    };
    entry.repos.add(d.repo);
    packageRepos.set(key, entry);
  }
  const runtimeOrder = [...runtimeRepos.entries()]
    .map(([name, repos]) => ({ name, count: repos.size }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .map((r) => r.name);
  const packages = keyPackages(packageRepos, input.packageColumns ?? STACK_PACKAGE_COLUMNS);

  const repos = input.repos.map(({ key: repo, name }): StackRepo => {
    const entries: StackEntry[] = [];
    for (const name of runtimeOrder) {
      const own = runtimes.filter((r) => r.repo === repo && r.name === name);
      if (own.length === 0) continue;
      entries.push({
        key: `runtime:${name}`,
        kind: "runtime",
        label: runtimeName(name),
        ...runtimeEntry(own, input.asOf),
      });
    }
    for (const p of packages) {
      const own = input.dependencies.filter(
        (d) => d.repo === repo && stackPackageKey(d.ecosystem ?? "npm", d.packageName) === p.key
      );
      const requirement = (d: DriftDependency) =>
        d.unresolved || (d.ecosystem === "GitHub Actions" && !semver.valid(d.installedVersion));
      const installed = own.filter((d) => !requirement(d)).map((d) => d.installedVersion);
      const required = own.find(requirement);
      const judged =
        installed.length === 0 && required
          ? ({
              version: required.installedVersion,
              status: "unknown",
              until: null,
              behind: 0,
              target: null,
              note: "A requirement, no installed version",
            } satisfies Judged)
          : packageEntry(installed, p.latest);
      if (!judged) continue;
      entries.push({
        key: `package:${p.key}`,
        kind: "package",
        label: p.label,
        ...(p.ecosystem ? { ecosystem: p.ecosystem } : {}),
        source: null,
        ...judged,
      });
    }
    const eolCount = entries.filter((e) => e.status === "eol").length;
    return {
      key: repo,
      repo: name,
      entries,
      urgency: repoUrgency(entries),
      eolCount,
      majorsBehind: entries.reduce((n, e) => n + (e.status === "major" ? e.behind : 0), 0),
      eol: eolCount > 0,
      drift: entries.some((e) => ENTRY_URGENCY[e.status] > 0),
    };
  });
  return repos.sort(compareStackRepos);
}
