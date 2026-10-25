import {
  URGENT_MAX_AGE_HOURS,
  compareDotted,
  mergeFixedVersions,
  releaseLineOf,
  type RuntimeItemMeta,
} from "./runtime-security";

// One security incident of a runtime reaches Briff as several items: a vendor advisory
// post, one release post per line ("PHP 8.3.36 Released!"), GitHub advisories. They fold
// into one block (urgent email) or one act item (weekly bulletin) with merged facts, so the
// same repo never gets the same action twice. Pure; shared by src/pipeline/runtime-urgent.ts
// and oneActPerRuntime in src/pipeline/bulletin.ts so both pick the same headline.

/** What the fold needs from an item. */
export interface IncidentFacts {
  runtime: string;
  meta: RuntimeItemMeta;
  publishedAt: Date | null;
  /** Item.contentHash: the last tie-break, as everywhere else. */
  contentHash: string;
}

const WINDOW_MS = URGENT_MAX_AGE_HOURS * 3_600_000;

function withinWindow(a: IncidentFacts, b: IncidentFacts): boolean {
  if (!a.publishedAt || !b.publishedAt) return true;
  return Math.abs(a.publishedAt.getTime() - b.publishedAt.getTime()) <= WINDOW_MS;
}

/**
 * Same incident: same runtime, published within 72h of each other, and a shared CVE id;
 * when one of them names no CVE (a bare release post), an overlapping fixed version.
 */
export function sameIncident(a: IncidentFacts, b: IncidentFacts): boolean {
  if (a.runtime !== b.runtime || !withinWindow(a, b)) return false;
  const cves = new Set(a.meta.cveIds.map((c) => c.toUpperCase()));
  if (b.meta.cveIds.some((c) => cves.has(c.toUpperCase()))) return true;
  if (a.meta.cveIds.length > 0 && b.meta.cveIds.length > 0) return false;
  const fixed = new Set(a.meta.fixedVersions);
  return b.meta.fixedVersions.some((v) => fixed.has(v));
}

/**
 * Lower is a better headline: the announcement that carried the incident from notice to
 * fix (`scheduledAt`/`fixAddedAt`), then the vendor's multi-line advisory post, then a
 * GitHub advisory, then a single-line release post; items without fixed versions last.
 */
function headlineRank(meta: RuntimeItemMeta): number {
  const hasFix = meta.fixedVersions.length > 0;
  if (!hasFix) return meta.scheduledAt ? 4 : 5;
  if (meta.kind === "announcement" && (meta.fixAddedAt || meta.scheduledAt)) return 0;
  if (meta.kind === "announcement" && !meta.lineSpecific) return 1;
  if (meta.kind === "advisory") return 2;
  return 3;
}

function byGhsaThenHash(a: IncidentFacts, b: IncidentFacts): number {
  const ga = a.meta.ghsaId ?? "";
  const gb = b.meta.ghsaId ?? "";
  return ga.localeCompare(gb) || a.contentHash.localeCompare(b.contentHash);
}

/** The item whose title heads the incident. */
export function incidentPrimary<T>(group: readonly T[], facts: (t: T) => IncidentFacts): T {
  const sorted = [...group].sort((x, y) => {
    const a = facts(x);
    const b = facts(y);
    return headlineRank(a.meta) - headlineRank(b.meta) || byGhsaThenHash(a, b);
  });
  if (sorted.length === 0) throw new Error("incidentPrimary: empty group");
  return sorted[0];
}

/** Primary first, then the posts by publication time, then the advisories by GHSA id. */
export function incidentSourceOrder<T>(group: readonly T[], facts: (t: T) => IncidentFacts): T[] {
  const primary = incidentPrimary(group, facts);
  const rest = group.filter((g) => g !== primary);
  const isAdvisory = (t: T) => facts(t).meta.kind === "advisory";
  const posts = rest
    .filter((t) => !isAdvisory(t))
    .sort((x, y) => {
      const a = facts(x);
      const b = facts(y);
      return (
        (a.publishedAt?.getTime() ?? 0) - (b.publishedAt?.getTime() ?? 0) ||
        a.contentHash.localeCompare(b.contentHash)
      );
    });
  const advisories = rest.filter(isAdvisory).sort((x, y) => byGhsaThenHash(facts(x), facts(y)));
  return [primary, ...posts, ...advisories];
}

/**
 * Items grouped into incidents (connected components of sameIncident). Groups come out
 * ordered by their earliest item, members in input order.
 */
export function groupIncidents<T>(items: readonly T[], facts: (t: T) => IncidentFacts): T[][] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (sameIncident(facts(items[i]), facts(items[j]))) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, T[]>();
  items.forEach((item, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), item]);
  });
  const start = (g: readonly T[]) =>
    Math.min(...g.map((t) => facts(t).publishedAt?.getTime() ?? 0));
  return [...groups.values()].sort(
    (a, b) =>
      start(a) - start(b) ||
      facts(incidentPrimary(a, facts)).contentHash.localeCompare(
        facts(incidentPrimary(b, facts)).contentHash
      )
  );
}

/**
 * Alert rank of a severity, lower is more urgent. Unknown severity ranks with high, as in
 * emailsImmediately: folding it with a low item must not silence the incident.
 */
function severityRank(s: string | null): number {
  switch (s?.toLowerCase() ?? null) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case null:
      return 1.5;
    case "medium":
    case "moderate":
      return 2;
    case "low":
      return 3;
    default:
      return 4;
  }
}

/**
 * Facts of the whole incident on top of the primary's: CVEs and fixed versions merged
 * (highest per line), the highest severity. Single-line release posts each speak for their
 * own line only, so when they are all the incident has, their lines become `affectedLines`
 * (another supported line is not affected; an end-of-life line still is).
 */
export function mergeIncidentMeta(
  runtime: string,
  primary: RuntimeItemMeta,
  metas: readonly RuntimeItemMeta[]
): RuntimeItemMeta {
  if (metas.length <= 1) return primary;
  const withFix = metas.filter((m) => m.fixedVersions.length > 0);
  const fixedVersions = mergeFixedVersions(
    runtime,
    metas.map((m) => m.fixedVersions)
  );
  const linesOf = (versions: readonly string[]) =>
    versions.flatMap((v) => releaseLineOf(runtime, v) ?? []);
  const spoken = withFix.length > 0 ? withFix : metas;
  const singleLine = spoken.filter((m) => m.lineSpecific);
  const wide = spoken.filter((m) => !m.lineSpecific);
  const listed =
    wide.length === 0
      ? linesOf(singleLine.flatMap((m) => m.fixedVersions))
      : wide.every((m) => m.affectedLines && m.affectedLines.length > 0)
        ? [
            ...wide.flatMap((m) => m.affectedLines ?? []),
            ...linesOf(singleLine.flatMap((m) => m.fixedVersions)),
          ]
        : [];
  const affectedLines = [...new Set(listed)].sort((a, b) => compareDotted(b, a));
  const severity = metas
    .map((m) => m.severity)
    .sort((a, b) => severityRank(a) - severityRank(b))[0];
  const scheduled = metas
    .flatMap((m) => (m.scheduledAt ? [m.scheduledAt] : []))
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  const merged: RuntimeItemMeta = {
    ...primary,
    cveIds: [...new Set(metas.flatMap((m) => m.cveIds.map((c) => c.toUpperCase())))].sort(),
    severity: severity ?? null,
    fixedVersions,
  };
  delete merged.lineSpecific;
  delete merged.affectedLines;
  if (affectedLines.length > 0) merged.affectedLines = affectedLines;
  if (fixedVersions.length === 0 && scheduled) merged.scheduledAt = scheduled;
  return merged;
}
