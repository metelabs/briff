import { runtimeVersionLabel } from "@/lib/runtime-range";
import {
  compareDotted,
  isExactVersion,
  releaseLineOf,
  repoFixStatus,
  runtimeName,
  type RepoFixStatus,
  type RuntimeItemMeta,
} from "@/lib/runtime-security";
import {
  IMAGE_RUNTIMES,
  isConstraintRow,
  isImageSource,
  runtimeEvidence,
  tagVersion,
} from "@scan/runtimes";

// Deterministic actions for runtime security items: what each affected repo
// should change, from the item's fixed versions and the repo's RepoRuntime rows.
// A floating image tag (`php:8.3-fpm`) follows patch releases, so a rebuild picks
// the fix up; a pinned tag or version file names the version to move to. Never a
// major upgrade: a line without a fix only gets the nearest fix on its major.

export interface RuntimeRow {
  repo: string;
  /** Runtime id (`php`). */
  name: string;
  /** Raw version: image tag (`8.3-fpm`), version file text or a constraint (`^8.3`). */
  version: string;
  normalized: string | null;
  /** File the version came from (`Dockerfile`, `composer.json require.php`). */
  source: string;
  unresolved: boolean;
  /** Image repository of a Dockerfile/compose row (`mcr.microsoft.com/dotnet/aspnet`); null when not recorded. */
  image?: string | null;
  /** The version is a constraint (`engines.node >=20`), not what runs; derived when absent. */
  constraint?: boolean | null;
}

const ACTION_MAX = 300;

/** Fallback image name for rows scanned before the repository was recorded: the first IMAGE_RUNTIMES entry. */
export function imageFor(runtime: string): string | null {
  const entry = Object.entries(IMAGE_RUNTIMES).find(([, id]) => id === runtime);
  return entry ? entry[0] : null;
}

/** Dockerfile and compose rows describe what actually runs; their version is an image tag. */
export function isImageRow(row: Pick<RuntimeRow, "source">): boolean {
  return isImageSource(row.source);
}

/**
 * Per repo and runtime, the rows that say what runs (runtimeEvidence): concrete rows when
 * the repo has any, else its root constraints, else every constraint. Order is kept.
 */
export function evidenceRows<T extends RuntimeRow>(rows: readonly T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = `${row.repo}\0${row.name}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const kept = new Set([...groups.values()].flatMap((list) => runtimeEvidence(list)));
  return rows.filter((r) => kept.has(r));
}

/** `php 8.3 (Dockerfile)`: what the repo declares, for the email. */
export function describeRow(row: RuntimeRow): string {
  if (row.unresolved) return `${row.name}, version unknown (${row.source}: ${row.version})`;
  return `${row.name} ${runtimeVersionLabel(row)} (${row.source})`;
}

/** Why an unresolved row has no version: `the Dockerfile tag uses a build argument: ${NODE_VERSION}`. */
function unresolvedReason(row: RuntimeRow): string {
  if (row.version.includes("$"))
    return `the ${row.source} tag uses a build argument: ${row.version}`;
  if (row.version.includes("@")) return `${row.source} pins the image by digest only`;
  return `${row.source}: ${row.version}`;
}

function rowRank(row: RuntimeRow): number {
  if (isImageRow(row)) return 0;
  if (!isConstraintRow(row)) return 1;
  return 2;
}

/** The row that best says what a repo runs: an image, else a plain version file, else a constraint. */
export function primaryRow(rows: readonly RuntimeRow[]): RuntimeRow | null {
  return (
    [...rows].sort((a, b) => rowRank(a) - rowRank(b) || a.source.localeCompare(b.source))[0] ?? null
  );
}

type FixMeta = Pick<RuntimeItemMeta, "fixedVersions" | "lineSpecific" | "affectedLines">;

/** `>=20.9.0`: a lower bound only, so any newer line satisfies it. */
function isOpenLowerBound(raw: string): boolean {
  return /^>=?\s*v?\d+(?:\.\d+){0,2}$/.test(raw.trim());
}

/**
 * What an item means for one row. An open lower bound (`engines.node >=20.9.0`) already
 * allows the newer lines, so its fix is the lowest fixed version at or above the bound
 * (22.23.4), not the bound's own line. A constraint is never called end-of-life: the line
 * it names may not be the one that runs, so it gets "check which version runs" instead.
 */
export function rowFixStatus(
  runtime: string,
  meta: FixMeta,
  row: RuntimeRow,
  asOf: Date = new Date()
): RepoFixStatus {
  const normalized = row.unresolved ? null : row.normalized;
  if (normalized && !isImageRow(row) && isOpenLowerBound(row.version)) {
    const fixed = meta.fixedVersions
      .filter((f) => releaseLineOf(runtime, f) !== null)
      .sort(compareDotted);
    if (fixed.length > 0) {
      const line = releaseLineOf(runtime, normalized);
      const onLine = line ? fixed.filter((f) => releaseLineOf(runtime, f) === line).at(-1) : null;
      if (onLine && compareDotted(normalized, onLine) >= 0) return { kind: "unaffected" };
      const next = fixed.find((f) => compareDotted(f, normalized) >= 0);
      if (next) {
        return { kind: "fix", line: releaseLineOf(runtime, next) as string, version: next };
      }
      return { kind: "unaffected" };
    }
    // Before the release: the bound allows the coming fix, whatever its own line's status.
    return { kind: "unknown" };
  }
  const status = repoFixStatus(runtime, meta, normalized, asOf);
  return status.kind === "eol" && isConstraintRow(row) ? { kind: "unknown" } : status;
}

export interface RepoRuntimeStatus {
  repo: string;
  row: RuntimeRow;
  status: RepoFixStatus;
}

/**
 * Per repo: its primary row and what the item means for it, judged on its evidence rows
 * (evidenceRows: an engines range never outweighs a Dockerfile or version file). Repos
 * already on a fixed version, or on a line a single-release post does not concern, are
 * left out.
 */
export function affectedRuntimeRepos(
  runtime: string,
  meta: FixMeta,
  rows: readonly RuntimeRow[],
  asOf: Date = new Date()
): RepoRuntimeStatus[] {
  const byRepo = new Map<string, RuntimeRow[]>();
  for (const row of evidenceRows(rows.filter((r) => r.name === runtime))) {
    byRepo.set(row.repo, [...(byRepo.get(row.repo) ?? []), row]);
  }
  const out: RepoRuntimeStatus[] = [];
  for (const [repo, list] of [...byRepo].sort(([a], [b]) => a.localeCompare(b))) {
    // A repo counts as affected when any of its declarations is (a Dockerfile on 8.3 and a
    // compose file on 8.4 are both deployed somewhere).
    const statuses = list.map((row) => ({ row, status: rowFixStatus(runtime, meta, row, asOf) }));
    const affected = statuses.filter((s) => s.status.kind !== "unaffected");
    if (affected.length === 0) continue;
    const primary = primaryRow(affected.map((s) => s.row)) as RuntimeRow;
    const status = affected.find((s) => s.row === primary)?.status as RepoFixStatus;
    out.push({ repo, row: primary, status });
  }
  return out;
}

export interface RuntimeRepoGaps {
  /** `sigma/forms-web (24.22.1 in Dockerfile)`: every row is past the fix or on a line the item does not concern. */
  unaffected: string[];
  /** Repos without a row of the runtime (it was removed since the match was made). */
  noVersion: string[];
}

/**
 * The repos of `repos` that get no action, and why, so an email never drops a matched repo
 * without a word. `rows` are the runtime rows of those repos.
 */
export function runtimeRepoGaps(
  runtime: string,
  meta: FixMeta,
  repos: readonly string[],
  rows: readonly RuntimeRow[],
  asOf: Date = new Date()
): RuntimeRepoGaps {
  const affected = new Set(affectedRuntimeRepos(runtime, meta, rows, asOf).map((a) => a.repo));
  const gaps: RuntimeRepoGaps = { unaffected: [], noVersion: [] };
  for (const repo of [...new Set(repos)].sort()) {
    if (affected.has(repo)) continue;
    const own = evidenceRows(rows.filter((r) => r.repo === repo && r.name === runtime));
    if (own.length === 0) {
      gaps.noVersion.push(repo);
      continue;
    }
    const versions = [...new Set(own.map((r) => `${runtimeVersionLabel(r)} in ${r.source}`))];
    gaps.unaffected.push(`${repo} (${versions.join(", ")})`);
  }
  return gaps;
}

/** One affected repo's action, `<repo>: <what to do>`; empty for an unaffected repo. */
export function repoAction(
  runtime: string,
  entry: RepoRuntimeStatus,
  fixed: readonly string[]
): string {
  const { repo, row, status } = entry;
  const name = runtimeName(runtime);
  switch (status.kind) {
    case "fix": {
      if (isImageRow(row)) {
        // The scanned repository wins: prefix-mapped images (.NET) have no Docker Hub name.
        const image = row.image ?? imageFor(runtime);
        const tagVer = tagVersion(row.version);
        const ref = (tag: string) => `${image ? `${image}:` : ""}${tag}`;
        if (tagVer && isExactVersion(runtime, tagVer)) {
          return `${repo}: move ${row.source} to ${ref(row.version.replace(tagVer, status.version))}`;
        }
        return `${repo}: rebuild to pick up ${name} ${status.version}; the ${ref(row.version)} tag already points to it`;
      }
      const raw = row.version.trim();
      if (/^v?\d/.test(raw)) return `${repo}: set ${runtime} ${status.version} in ${row.source}`;
      return `${repo}: run ${runtime} ${status.version} or later (${row.source} allows ${raw})`;
    }
    case "unsupported":
      return status.nearest
        ? `${repo}: ${name} ${status.line} gets no fix; move to ${status.nearest} (same major)`
        : `${repo}: ${name} ${status.line} gets no fix; plan the move to a supported release line`;
    case "eol":
      return status.target
        ? `${repo}: ${runtime} ${status.line} is end-of-life and will not get this fix; move to ${status.target} or later`
        : `${repo}: ${runtime} ${status.line} is end-of-life and will not get this fix; move to a supported release line`;
    case "unknown":
      if (row.unresolved) {
        return `${repo}: ${runtime} version unknown (${unresolvedReason(row)}); check which version runs; fixed in ${fixed.join(", ")}`;
      }
      return `${repo}: check which ${name} version runs (${row.source}: ${row.version}); fixed in ${fixed.join(", ")}`;
    case "unaffected":
      return "";
  }
}

/** "21 Oct 2026, 14:00 UTC", or "21 Oct 2026" for a day without a time (`YYYY-MM-DD`). */
export function formatUtc(value: string): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = `${d.getUTCDate()} ${month} ${d.getUTCFullYear()}`;
  if (dateOnly) return day;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day}, ${hh}:${mm} UTC`;
}

/**
 * The act item's action: one clause per affected repo, joined with " · ". Without
 * fixed versions it says to update once the announced release is out, or to read the
 * advisory. Null when no repo is affected.
 */
type ActionMeta = FixMeta & Pick<RuntimeItemMeta, "scheduledAt">;

/**
 * One clause per affected repo (`garden.example: rebuild to pick up ...`), untruncated: the
 * "fix is out" follow-up lists each repo on its own line. Before the release, repos on a
 * supported line share one "as soon as the fixed release is out" clause.
 */
export function runtimeRepoActions(
  runtime: string,
  meta: ActionMeta,
  rows: readonly RuntimeRow[],
  asOf: Date = new Date()
): string[] {
  const affected = affectedRuntimeRepos(runtime, meta, rows, asOf);
  if (affected.length === 0) return [];
  if (meta.fixedVersions.length > 0) {
    return affected.map((a) => repoAction(runtime, a, meta.fixedVersions));
  }
  const name = runtimeName(runtime);
  const eol = affected.filter((a) => a.status.kind === "eol");
  const waiting = affected.filter((a) => a.status.kind !== "eol");
  const repos = waiting.map((a) => a.repo).join(", ");
  const pending =
    waiting.length === 0
      ? []
      : [
          meta.scheduledAt
            ? `Update ${name} in ${repos} as soon as the fixed release is out (announced for ${formatUtc(meta.scheduledAt)}).`
            : `Read the advisory and check ${repos}; it names no fixed ${name} version yet.`,
        ];
  return [...pending, ...eol.map((a) => repoAction(runtime, a, meta.fixedVersions))];
}

export function runtimeAction(
  runtime: string,
  meta: ActionMeta,
  rows: readonly RuntimeRow[],
  asOf: Date = new Date()
): string | null {
  const clauses = runtimeRepoActions(runtime, meta, rows, asOf);
  if (clauses.length === 0) return null;
  const name = runtimeName(runtime);
  if (meta.fixedVersions.length === 0) return clauses.join(" · ");
  const affected = affectedRuntimeRepos(runtime, meta, rows, asOf);
  const text = clauses.join(" · ");
  if (text.length <= ACTION_MAX) return text;
  const fixes = affected.flatMap((a) => (a.status.kind === "fix" ? [a.status.version] : []));
  const short = `Update ${name} to ${[...new Set(fixes)].join(" / ") || meta.fixedVersions.join(" / ")} in ${affected.length} repos (see the advisory).`;
  return short.length <= ACTION_MAX ? short : null;
}
