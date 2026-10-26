import { cvssLevel, type SeverityLevel } from "@/security/cvss";
import { fixedVersionFor, severityLevelOf, type OsvRange } from "@/sources/osv";
import type { Ecosystem } from "@scan/ecosystems";

// Pure parts of the security line (plan §7.4): query planning, alert dedupe and
// alert grouping for the email. The job in ./scan.ts does the I/O around them.

export interface StackDependency {
  orgId: string;
  repoId: string;
  repoName: string;
  packageId: string;
  ecosystem: Ecosystem;
  name: string;
  version: string;
  direct: boolean;
}

export interface PlannedQuery {
  key: string;
  ecosystem: Ecosystem;
  name: string;
  version: string;
  packageId: string;
  /** True when any repo depends on this package+version directly. */
  direct: boolean;
  dependents: StackDependency[];
}

/** `next@16.4.1` for npm (as before other ecosystems), `Packagist:symfony/http-kernel@6.4.3` otherwise. */
export const queryKey = (name: string, version: string, ecosystem: Ecosystem = "npm") =>
  ecosystem === "npm" ? `${name}@${version}` : `${ecosystem}:${name}@${version}`;

/**
 * One OSV query per installed (ecosystem, package, version) across all orgs; direct
 * dependencies first. The same name in two ecosystems is two queries.
 */
export function planQueries(deps: StackDependency[]): PlannedQuery[] {
  const byKey = new Map<string, PlannedQuery>();
  for (const dep of deps) {
    const key = queryKey(dep.name, dep.version, dep.ecosystem);
    const entry = byKey.get(key) ?? {
      key,
      ecosystem: dep.ecosystem,
      name: dep.name,
      version: dep.version,
      packageId: dep.packageId,
      direct: false,
      dependents: [],
    };
    entry.direct ||= dep.direct;
    entry.dependents.push(dep);
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort(
    (a, b) => Number(b.direct) - Number(a.direct) || a.key.localeCompare(b.key)
  );
}

export type AlertKind = "backlog" | "new";

export interface AlertCandidate {
  orgId: string;
  advisoryId: string;
  repoId: string;
  kind: AlertKind;
}

/**
 * Backlog when the repo has had no security scan since it was (re-)added: whatever that
 * scan finds was already there. Otherwise the pair is new by construction: one Alert per
 * (advisory × repo) ever, so a pair first seen on a scanned repo means OSV published or
 * changed the advisory, or the installed version changed. (An earlier scan that missed an
 * advisory, e.g. a failed fetch, also lands here; the user has not heard of it either.)
 */
export function alertKindFor(repo: {
  securityScannedAt: Date | null;
  includedChangedAt: Date | null;
}): AlertKind {
  if (!repo.securityScannedAt) return "backlog";
  if (repo.includedChangedAt && repo.includedChangedAt > repo.securityScannedAt) return "backlog";
  return "new";
}

export const alertKey = (advisoryId: string, repoId: string) => `${advisoryId}:${repoId}`;

/**
 * Alerts that do not exist yet. An advisory already alerted for a repo is never
 * re-created; the same advisory reaching a new repo yields an alert for that repo only.
 */
export function newAlertCandidates(
  matches: { query: PlannedQuery; advisoryIds: string[] }[],
  existing: ReadonlySet<string>,
  kindOf: (repoId: string) => AlertKind = () => "new"
): AlertCandidate[] {
  const out = new Map<string, AlertCandidate>();
  for (const { query, advisoryIds } of matches) {
    for (const advisoryId of advisoryIds) {
      for (const dep of query.dependents) {
        const key = alertKey(advisoryId, dep.repoId);
        if (existing.has(key) || out.has(key)) continue;
        out.set(key, {
          orgId: dep.orgId,
          advisoryId,
          repoId: dep.repoId,
          kind: kindOf(dep.repoId),
        });
      }
    }
  }
  return [...out.values()];
}

export interface StoredAlert {
  id: string;
  advisoryId: string;
  repoId: string;
  kind: AlertKind;
  deliveredAt: Date | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

export interface AlertMergePlan {
  /** Alerts folded into another one of the same (vulnerability × repo); deleted first. */
  deleteIds: string[];
  /** The kept alert of each pair: moved onto the canonical advisory, delivery state merged. */
  updates: { id: string; advisoryId: string; deliveredAt: Date | null; reviewedAt: Date | null }[];
}

const earliest = (dates: readonly (Date | null)[]): Date | null =>
  dates.reduce<Date | null>((min, d) => (d && (!min || d < min) ? d : min), null);

/**
 * Alerts of duplicate advisories (`targetOf`: duplicate advisory id -> canonical id) folded
 * onto the canonical advisory, one alert per (advisory × repo) as before. The oldest alert of
 * a pair is kept, so its kind and age stay; it counts as delivered (and a backlog one as
 * reviewed) when any alert of the pair was, so a merge never emails anything again.
 */
export function planAlertMerge(
  alerts: readonly StoredAlert[],
  targetOf: ReadonlyMap<string, string>
): AlertMergePlan {
  const pairs = new Map<string, { target: string; alerts: StoredAlert[] }>();
  for (const alert of alerts) {
    const target = targetOf.get(alert.advisoryId) ?? alert.advisoryId;
    const key = alertKey(target, alert.repoId);
    const pair = pairs.get(key) ?? { target, alerts: [] };
    pair.alerts.push(alert);
    pairs.set(key, pair);
  }
  const plan: AlertMergePlan = { deleteIds: [], updates: [] };
  for (const { target, alerts: list } of pairs.values()) {
    if (list.every((a) => a.advisoryId === target)) continue;
    const [keep, ...rest] = [...list].sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() ||
        Number(b.advisoryId === target) - Number(a.advisoryId === target) ||
        a.id.localeCompare(b.id)
    );
    plan.deleteIds.push(...rest.map((a) => a.id));
    plan.updates.push({
      id: keep.id,
      advisoryId: target,
      deliveredAt: earliest(list.map((a) => a.deliveredAt)),
      reviewedAt:
        keep.kind === "backlog"
          ? earliest(list.filter((a) => a.kind === "backlog").map((a) => a.reviewedAt))
          : keep.reviewedAt,
    });
  }
  return plan;
}

const SEVERITY_RANK: Record<SeverityLevel, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MODERATE: 2,
  LOW: 1,
};

/**
 * The stored severity as a level. Advisories hold a level since the OSV adapter normalises
 * it; a raw CVSS vector (rows stored before that, until the next scan refetches them) is
 * scored here, so every reader compares levels.
 */
export function severityLevel(severity: string | null | undefined): SeverityLevel | null {
  if (!severity) return null;
  if (severity.startsWith("CVSS:")) return cvssLevel(severity);
  return severityLevelOf(severity);
}

export function severityRank(severity: string | null | undefined): number {
  const level = severityLevel(severity);
  return level ? SEVERITY_RANK[level] : 0;
}

/**
 * Same-day email threshold on the normalised level: critical and high. Unknown severity
 * (none, or a vector that cannot be scored) counts as high; moderate and low wait for the
 * weekly bulletin.
 */
export function emailsImmediately(severity: string | null): boolean {
  const rank = severityRank(severity);
  return rank === 0 || rank >= SEVERITY_RANK.HIGH;
}

export interface PendingAlert {
  kind: AlertKind;
  advisoryId: string;
  repo: { name: string };
  advisory: { severity: string | null };
}

/**
 * What one run emails from the live undelivered alerts: new critical/high ones one by one,
 * the backlog as one first-scan summary. `held` counts the new moderate/low ones, which
 * stay undelivered (bulletin only, unless OSV later raises their severity).
 */
export function splitPending<T extends PendingAlert>(
  live: readonly T[]
): { urgent: T[]; backlog: T[]; held: number } {
  const urgent = live.filter((a) => a.kind === "new" && emailsImmediately(a.advisory.severity));
  const backlog = live.filter((a) => a.kind === "backlog");
  return { urgent, backlog, held: live.length - urgent.length - backlog.length };
}

/** Counts for the first-scan email; null without backlog. */
export function backlogSummary(
  backlog: readonly PendingAlert[]
): { repos: string[]; advisories: number; severe: number } | null {
  if (backlog.length === 0) return null;
  return {
    repos: [...new Set(backlog.map((a) => a.repo.name))].sort(),
    advisories: new Set(backlog.map((a) => a.advisoryId)).size,
    // Counted as rated: the sentence says "critical or high", unrated ones are not.
    severe: new Set(
      backlog
        .filter((a) => severityRank(a.advisory.severity) >= SEVERITY_RANK.HIGH)
        .map((a) => a.advisoryId)
    ).size,
  };
}

/** Short label: the level, or UNKNOWN (never empty) when there is none. */
export function severityLabel(severity: string | null | undefined): string {
  return severityLevel(severity) ?? "UNKNOWN";
}

export interface AlertGroupRepo {
  name: string;
  installedVersion: string;
  direct: boolean;
}

export interface AlertGroup {
  osvId: string;
  packageName: string;
  summary: string | null;
  severity: string | null;
  affected: OsvRange[];
  fallbackFixed: string | null;
  repos: AlertGroupRepo[];
}

export function osvLink(osvId: string): string {
  return `https://osv.dev/vulnerability/${encodeURIComponent(osvId)}`;
}

/** Fixed version for the installed versions in this group, else the advisory's list. */
export function fixedFor(group: AlertGroup): string | null {
  const fixes = new Set<string>();
  for (const repo of group.repos) {
    const fix = fixedVersionFor(group.affected, repo.installedVersion);
    if (fix) fixes.add(fix);
  }
  if (fixes.size > 0) return [...fixes].join(", ");
  return group.fallbackFixed;
}

/** One package whose advisories reach every listed repo only as a transitive dependency. */
export interface TransitivePackageGroup {
  packageName: string;
  /** The most severe advisory's severity. */
  severity: string | null;
  /** Most severe first. */
  osvIds: string[];
  repos: { name: string; installedVersion: string }[];
}

/**
 * Advisories with at least one direct repo stay one group each (they get a fix);
 * transitive-only ones are merged per package, since the fix is an update of whatever
 * pulls the package in, which the dependency rows do not record.
 */
export function splitTransitive(groups: AlertGroup[]): {
  direct: AlertGroup[];
  transitive: TransitivePackageGroup[];
} {
  const direct: AlertGroup[] = [];
  const byPackage = new Map<string, AlertGroup[]>();
  for (const g of groups) {
    if (g.repos.some((r) => r.direct)) direct.push(g);
    else byPackage.set(g.packageName, [...(byPackage.get(g.packageName) ?? []), g]);
  }
  const transitive = [...byPackage.entries()].map(([packageName, list]) => {
    const sorted = [...list].sort(
      (a, b) =>
        severityRank(b.severity) - severityRank(a.severity) || a.osvId.localeCompare(b.osvId)
    );
    const repos = new Map<string, string>();
    for (const g of sorted)
      for (const r of g.repos) if (!repos.has(r.name)) repos.set(r.name, r.installedVersion);
    return {
      packageName,
      severity: sorted[0].severity,
      osvIds: sorted.map((g) => g.osvId),
      repos: [...repos.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, installedVersion]) => ({ name, installedVersion })),
    };
  });
  transitive.sort(
    (a, b) =>
      severityRank(b.severity) - severityRank(a.severity) ||
      a.packageName.localeCompare(b.packageName)
  );
  return { direct: sortGroups(direct), transitive };
}

export function sortGroups(groups: AlertGroup[]): AlertGroup[] {
  return [...groups].sort(
    (a, b) =>
      Number(b.repos.some((r) => r.direct)) - Number(a.repos.some((r) => r.direct)) ||
      severityRank(b.severity) - severityRank(a.severity) ||
      a.packageName.localeCompare(b.packageName)
  );
}
