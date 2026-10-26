import semver from "semver";

import { lineLifecycle } from "@/lib/runtime-eol";
import { runtimeVersionLabel } from "@/lib/runtime-range";
import { releaseLineOf, runtimeName } from "@/lib/runtime-security";
import { stackPackageKey } from "@/lib/match/matcher";
import { ecosystemLabel } from "@scan/ecosystems";
import { isConstraintRow, runtimeEvidence } from "@scan/runtimes";

import { releaseLine } from "./fixes";

// The Stack page: repo x runtime and repo x top direct packages. Runtimes are judged
// against the end-of-life table (src/lib/runtime-eol.ts), never against a "latest"
// version we do not store. Packages are judged against Package.latestVersion
// (refresh-packages: npm "latest" dist-tag, newest stable Packagist release); without it a
// cell shows the installed version only.

export type DriftStatus = "ok" | "minor" | "major" | "eol" | "plain" | "none";

export interface DriftColumn {
  key: string;
  kind: "runtime" | "package";
  label: string;
  /**
   * Packages only: the ecosystem label (`npm`, `Composer`) when the package columns span more
   * than one ecosystem, so `npm` and `Composer` columns of similar names are told apart.
   */
  ecosystem?: string;
  /** Latest known version (packages only); null when there is no data. */
  latest: string | null;
}

export interface DriftCell {
  version: string | null;
  status: DriftStatus;
  /** Release lines behind the latest (major behind only). */
  behind: number;
  /** Where the version comes from (runtimes): `Dockerfile`, `.nvmrc +1`. */
  source: string | null;
}

export interface DriftRow {
  repo: string;
  cells: Record<string, DriftCell>;
  majorsBehind: number;
  eol: boolean;
  drift: boolean;
}

export interface DriftRuntimeRow {
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

const NONE: DriftCell = { version: null, status: "none", behind: 0, source: null };

function runtimeCell(rows: readonly DriftRuntimeRow[], asOf: Date): DriftCell {
  // Concrete rows speak for the repo when it has any; a constraint is never end-of-life
  // (`engines.node >=20` allows 22), and a workspace package's never outweighs the root's.
  const evidence = runtimeEvidence(rows.map((r) => ({ ...r, unresolved: r.unresolved ?? false })));
  const judged = evidence.map((r) => {
    const shown = runtimeVersionLabel(r);
    const line = releaseLineOf(r.name, r.normalized ?? r.version);
    const eol = !isConstraintRow(r) && line !== null && lineLifecycle(r.name, line, asOf) === "eol";
    return { row: r, shown, eol };
  });
  // The worst row speaks for the repo: an end-of-life line anywhere, else the image row
  // (what actually runs), else the first file.
  judged.sort(
    (a, b) =>
      Number(b.eol) - Number(a.eol) ||
      Number(b.row.image !== null) - Number(a.row.image !== null) ||
      a.row.source.localeCompare(b.row.source)
  );
  const pick = judged[0];
  const files = [...new Set(rows.map((r) => r.source))];
  return {
    version: pick.shown,
    status: pick.eol ? "eol" : "plain",
    behind: 0,
    source: files.length > 1 ? `${pick.row.source} +${files.length - 1}` : pick.row.source,
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

export function packageCell(
  installedVersions: readonly string[],
  latest: string | null
): DriftCell {
  const parsed = installedVersions
    .map((raw) => ({ raw, sem: toSemver(raw) }))
    .sort((a, b) => (a.sem && b.sem ? semver.compare(a.sem, b.sem) : a.sem ? -1 : 1));
  const lowest = parsed[0];
  if (!lowest) return NONE;
  const latestSem = latest ? toSemver(latest) : null;
  const version = lowest.raw;
  if (!lowest.sem || !latestSem) return { version, status: "plain", behind: 0, source: null };
  if (semver.gte(lowest.sem, latestSem)) return { version, status: "ok", behind: 0, source: null };
  if (releaseLine(lowest.sem.version) === releaseLine(latestSem.version)) {
    return { version, status: "minor", behind: 0, source: null };
  }
  return { version, status: "major", behind: linesBehind(lowest.sem, latestSem), source: null };
}

function packageColumns(
  packages: ReadonlyMap<
    string,
    { name: string; ecosystem: string; repos: Set<string>; latest: string | null }
  >,
  limit: number
): DriftColumn[] {
  const top = [...packages.entries()]
    .map(([key, e]) => ({ key, ...e, count: e.repos.size }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
  const mixed = new Set(top.map((p) => p.ecosystem)).size > 1;
  return top.map((p) => ({
    key: `package:${p.key}`,
    kind: "package" as const,
    label: p.name,
    latest: p.latest,
    ...(mixed || p.ecosystem === "GitHub Actions"
      ? { ecosystem: ecosystemLabel(p.ecosystem) }
      : {}),
  }));
}

/**
 * Columns: every runtime a repo declares (most common first), then the direct packages
 * used by the most repos. Rows: end-of-life first, then most majors behind, then name.
 */
export function computeDrift(input: {
  repos: readonly string[];
  runtimes: readonly DriftRuntimeRow[];
  dependencies: readonly DriftDependency[];
  asOf: Date;
  packageColumns?: number;
}): { columns: DriftColumn[]; rows: DriftRow[] } {
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
    // Type packages follow their library; a column of them says nothing new.
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
  const byUse = (a: { name: string; count: number }, b: { name: string; count: number }) =>
    b.count - a.count || a.name.localeCompare(b.name);

  const columns: DriftColumn[] = [
    ...[...runtimeRepos.entries()]
      .map(([name, repos]) => ({ name, count: repos.size }))
      .sort(byUse)
      .map(({ name }) => ({
        key: `runtime:${name}`,
        kind: "runtime" as const,
        label: runtimeName(name),
        latest: null,
      })),
    ...packageColumns(packageRepos, input.packageColumns ?? STACK_PACKAGE_COLUMNS),
  ];

  const rows = input.repos.map((repo) => {
    const cells: Record<string, DriftCell> = {};
    for (const col of columns) {
      if (col.kind === "runtime") {
        const name = col.key.slice("runtime:".length);
        const own = runtimes.filter((r) => r.repo === repo && r.name === name);
        cells[col.key] = own.length > 0 ? runtimeCell(own, input.asOf) : NONE;
      } else {
        const key = col.key.slice("package:".length);
        const own = input.dependencies.filter(
          (d) => d.repo === repo && stackPackageKey(d.ecosystem ?? "npm", d.packageName) === key
        );
        const installed = own.filter((d) => !d.unresolved).map((d) => d.installedVersion);
        const required = own.find((d) => d.unresolved);
        cells[col.key] =
          installed.length === 0 && required
            ? {
                version: required.installedVersion,
                status: "plain",
                behind: 0,
                source: "requirement, no installed version",
              }
            : packageCell(installed, col.latest);
      }
    }
    const values = Object.values(cells);
    return {
      repo,
      cells,
      majorsBehind: values.reduce((n, c) => n + (c.status === "major" ? c.behind : 0), 0),
      eol: values.some((c) => c.status === "eol"),
      drift: values.some((c) => c.status === "minor" || c.status === "major" || c.status === "eol"),
    };
  });
  rows.sort(
    (a, b) =>
      Number(b.eol) - Number(a.eol) ||
      b.majorsBehind - a.majorsBehind ||
      a.repo.localeCompare(b.repo)
  );
  return { columns, rows };
}
