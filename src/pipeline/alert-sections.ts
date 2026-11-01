// The Alerts page's sections and its progress numbers: which section an alert belongs to,
// the alerts fixed since the member's last visit (per section), and the re-check limit.

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
