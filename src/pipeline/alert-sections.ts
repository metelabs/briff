import { asEcosystem, type Ecosystem } from "@scan/ecosystems";
import { severityLabel } from "@/security/plan";

// The Alerts page's sections and its progress numbers: which section an alert belongs to,
// the Resolved section (and its "Resolved: N this week" counter), how an open alert gets
// noticed as fixed, and the re-check limit.

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
  resolvedAt: Date | null;
}

/** Alerts (advisory x repo) resolved since `weekStart`: the header counter and Home's tile. */
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

/** The Resolved section reads alerts resolved this recently. */
export const RESOLVED_WINDOW_MS = 30 * 86_400_000;

/** Resolved alerts inside the window: the list the counter and the Resolved section read. */
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
  /** Repo names are unique per source only; the id keeps two same-named repos' cards apart. */
  repoId: string;
  repo: { name: string };
  advisory: {
    osvId: string;
    severity: string | null;
    package: { name: string; ecosystem: string };
  };
}

/** One card in the Resolved section: one alert (advisory x repo), as the counter counts. */
export interface ResolvedAlert {
  key: string;
  packageName: string;
  /** The package's ecosystem when it is not npm (shown as a tag, as on open alerts). */
  ecosystem?: Exclude<Ecosystem, "npm">;
  osvId: string;
  repo: string;
  /** "UNKNOWN" when the advisory has no level. */
  severity: string;
  resolvedAt: Date;
  cause: string;
  /** Resolved after the member's previous visit (a badge, never a filter). */
  sinceLastVisit: boolean;
}

export interface ResolvedSections {
  /** Resolved since Monday: exactly the alerts `resolvedSince` counts. */
  thisWeek: ResolvedAlert[];
  /** Resolved before Monday, inside the rows given (the 30-day window). */
  earlier: ResolvedAlert[];
}

/** The Resolved section: one card per resolved alert, latest first, split at the week start. */
export function resolvedSections(
  rows: readonly ResolvedSectionRow[],
  weekStart: Date,
  lastVisit: Date | null
): ResolvedSections {
  const out: ResolvedSections = { thisWeek: [], earlier: [] };
  for (const row of rows) {
    if (!row.resolvedAt) continue;
    const { name } = row.advisory.package;
    const ecosystem = asEcosystem(row.advisory.package.ecosystem);
    const alert: ResolvedAlert = {
      key: `${row.advisory.osvId}\0${row.repoId}`,
      packageName: name,
      ...(ecosystem && ecosystem !== "npm" ? { ecosystem } : {}),
      osvId: row.advisory.osvId,
      repo: row.repo.name,
      severity: severityLabel(row.advisory.severity),
      resolvedAt: row.resolvedAt,
      cause: resolvedCauseLabel(row.resolvedBy),
      sinceLastVisit: lastVisit !== null && row.resolvedAt > lastVisit,
    };
    (row.resolvedAt >= weekStart ? out.thisWeek : out.earlier).push(alert);
  }
  const order = (a: ResolvedAlert, b: ResolvedAlert) =>
    b.resolvedAt.getTime() - a.resolvedAt.getTime() ||
    a.packageName.localeCompare(b.packageName) ||
    a.repo.localeCompare(b.repo) ||
    a.osvId.localeCompare(b.osvId);
  out.thisWeek.sort(order);
  out.earlier.sort(order);
  return out;
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
