import { asEcosystem, type Ecosystem } from "@scan/ecosystems";
import { severityLabel, severityRank } from "@/security/plan";

// The Alerts page's sections and its progress numbers: which section an alert belongs to,
// the alerts fixed since the member's last visit (per section), the Resolved section, how
// an open alert gets noticed as fixed, and the re-check limit.

export type AlertSection = "this-week" | "earlier" | "backlog";

export const ALERT_SECTIONS: readonly { id: AlertSection; label: string }[] = [
  { id: "this-week", label: "New this week" },
  { id: "earlier", label: "Earlier" },
  { id: "backlog", label: "First-scan backlog" },
];

export function alertSectionOf(
  alert: { kind: string; createdAt: Date },
  weekStart: Date
): AlertSection {
  if (alert.kind === "backlog") return "backlog";
  return alert.createdAt >= weekStart ? "this-week" : "earlier";
}

export interface ResolvedAlertRow {
  kind: string;
  createdAt: Date;
  resolvedAt: Date | null;
  repo: { name: string };
  advisory: { package: { name: string } };
}

export interface FixedPackage {
  packageName: string;
  repos: string[];
}

/**
 * Alerts resolved after `since` (the member's previous visit), one entry per package and
 * section, repos merged; packages in name order. Nothing before a first visit.
 */
export function fixedSince(
  rows: readonly ResolvedAlertRow[],
  since: Date | null,
  weekStart: Date
): Record<AlertSection, FixedPackage[]> {
  const out: Record<AlertSection, Map<string, Set<string>>> = {
    "this-week": new Map(),
    earlier: new Map(),
    backlog: new Map(),
  };
  if (since) {
    for (const row of rows) {
      if (!row.resolvedAt || row.resolvedAt <= since) continue;
      const byPackage = out[alertSectionOf(row, weekStart)];
      const repos = byPackage.get(row.advisory.package.name) ?? new Set<string>();
      byPackage.set(row.advisory.package.name, repos.add(row.repo.name));
    }
  }
  const list = (m: Map<string, Set<string>>): FixedPackage[] =>
    [...m]
      .map(([packageName, repos]) => ({ packageName, repos: [...repos].sort() }))
      .sort((a, b) => a.packageName.localeCompare(b.packageName));
  return {
    "this-week": list(out["this-week"]),
    earlier: list(out.earlier),
    backlog: list(out.backlog),
  };
}

/** Alerts (advisory x repo) resolved since `weekStart`. */
export function resolvedSince(
  rows: readonly Pick<ResolvedAlertRow, "resolvedAt">[],
  weekStart: Date
): number {
  return rows.filter((r) => r.resolvedAt !== null && r.resolvedAt >= weekStart).length;
}

/** "Re-check now" rescans the org's GitHub App repos at most once per interval. */
export const RECHECK_INTERVAL_MS = 10 * 60_000;

/** Milliseconds until the next re-check is allowed; 0 when it is allowed now. */
export function recheckWaitMs(lastRequestedAt: Date | null, now: Date): number {
  if (!lastRequestedAt) return 0;
  return Math.max(0, lastRequestedAt.getTime() + RECHECK_INTERVAL_MS - now.getTime());
}

/** The Resolved section and "Fixed since your last visit" both read alerts resolved this recently. */
export const RESOLVED_WINDOW_MS = 30 * 86_400_000;

/** Resolved alerts inside the window: the one list both resolved views are built from. */
export function recentlyResolved<T extends Pick<ResolvedAlertRow, "resolvedAt">>(
  rows: readonly T[],
  now: Date
): T[] {
  const since = now.getTime() - RESOLVED_WINDOW_MS;
  return rows.filter((r) => r.resolvedAt !== null && r.resolvedAt.getTime() >= since);
}

/** Alert.resolvedBy; null on rows resolved before it was recorded. */
export type ResolvedCause = "briff_scan" | "github_app" | "security_scan" | null;

export function resolvedCauseLabel(cause: ResolvedCause): string {
  switch (cause) {
    case "briff_scan":
      return "newer upload from briff-scan";
    case "github_app":
      return "GitHub App scan";
    case "security_scan":
      return "security-scan re-check";
    default:
      return "a later scan";
  }
}

export interface ResolvedSectionRow extends ResolvedAlertRow {
  resolvedBy: ResolvedCause;
  advisory: { severity: string | null; package: { name: string; ecosystem: string } };
}

export interface ResolvedPackage {
  packageName: string;
  /** The package's ecosystem when it is not npm (shown as a tag, as on open alerts). */
  ecosystem?: Exclude<Ecosystem, "npm">;
  repos: string[];
  /** The most severe of its resolved advisories ("UNKNOWN" when none has a level). */
  severity: string;
  /** The latest resolution. */
  resolvedAt: Date;
  /** Distinct causes, labelled, in the order of `resolvedCauseLabel`'s cases. */
  causes: string[];
}

const CAUSE_ORDER: ResolvedCause[] = ["briff_scan", "github_app", "security_scan", null];

/** One row per package, latest resolution first. */
export function resolvedPackages(rows: readonly ResolvedSectionRow[]): ResolvedPackage[] {
  const byPackage = new Map<
    string,
    {
      packageName: string;
      ecosystem: Ecosystem | undefined;
      repos: Set<string>;
      severity: string | null;
      resolvedAt: Date;
      causes: Set<ResolvedCause>;
    }
  >();
  for (const row of rows) {
    if (!row.resolvedAt) continue;
    const { name } = row.advisory.package;
    const ecosystem = asEcosystem(row.advisory.package.ecosystem);
    // (ecosystem, name) is the package, as in alertGroupsOf.
    const key = `${ecosystem ?? "npm"}\0${name}`;
    const entry = byPackage.get(key) ?? {
      packageName: name,
      ecosystem,
      repos: new Set<string>(),
      severity: row.advisory.severity,
      resolvedAt: row.resolvedAt,
      causes: new Set<ResolvedCause>(),
    };
    entry.repos.add(row.repo.name);
    entry.causes.add(row.resolvedBy);
    if (severityRank(row.advisory.severity) > severityRank(entry.severity))
      entry.severity = row.advisory.severity;
    if (row.resolvedAt > entry.resolvedAt) entry.resolvedAt = row.resolvedAt;
    byPackage.set(key, entry);
  }
  return [...byPackage.values()]
    .map((e) => ({
      packageName: e.packageName,
      ...(e.ecosystem && e.ecosystem !== "npm" ? { ecosystem: e.ecosystem } : {}),
      repos: [...e.repos].sort(),
      severity: severityLabel(e.severity),
      resolvedAt: e.resolvedAt,
      causes: CAUSE_ORDER.filter((c) => e.causes.has(c)).map(resolvedCauseLabel),
    }))
    .sort(
      (a, b) =>
        b.resolvedAt.getTime() - a.resolvedAt.getTime() ||
        a.packageName.localeCompare(b.packageName)
    );
}

/** How a repo's scans reach Briff: the GitHub App (rescans on push) or briff-scan uploads. */
export type RepoConnection = "app" | "scanner";

/** Which "how Briff notices the fix" line an open package group gets. */
export type FixHint = "app" | "scanner" | "mixed";

export function fixHintFor(
  repos: readonly string[],
  connectionsOf: ReadonlyMap<string, ReadonlySet<RepoConnection>>
): FixHint | null {
  const kinds = new Set<RepoConnection>();
  for (const repo of repos) for (const kind of connectionsOf.get(repo) ?? []) kinds.add(kind);
  if (kinds.size === 0) return null;
  if (kinds.size > 1) return "mixed";
  return kinds.has("app") ? "app" : "scanner";
}

/** Repo name -> how its scans arrive. Two repos can share a name across sources. */
export function repoConnections(
  repos: readonly { name: string; githubInstallationId: string | null }[]
): Map<string, Set<RepoConnection>> {
  const out = new Map<string, Set<RepoConnection>>();
  for (const repo of repos) {
    const kinds = out.get(repo.name) ?? new Set<RepoConnection>();
    kinds.add(repo.githubInstallationId !== null ? "app" : "scanner");
    out.set(repo.name, kinds);
  }
  return out;
}
