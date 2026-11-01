import { affectedInstalls, type OsvRange } from "@/sources/osv";

// Alert resolution on scan ingestion: an upload replaces a repo's dependency rows, so it
// is the moment to tell whether an alert's package is still installed at a version the
// advisory affects. Resolved alerts keep their row (resolvedAt), so delivery state and
// the one-alert-per-(advisory x repo) rule stay intact; a vulnerable version coming back
// clears resolvedAt again.

export interface ResolvableAlert {
  id: string;
  resolvedAt: Date | null;
  /** The advisory's package and its stored ranges (Advisory.affected). */
  packageId: string;
  ecosystem: string;
  packageName: string;
  affected: unknown;
  /** Every package the OSV record covers (Advisory.packages); null when not known yet. */
  covered: unknown;
}

export interface InstalledDependency {
  packageId: string;
  ecosystem: string;
  name: string;
  version: string;
  unresolved: boolean;
  constraint: boolean;
}

export interface ResolutionPlan {
  resolve: string[];
  reopen: string[];
}

function rangesOf(affected: unknown): OsvRange[] {
  return Array.isArray(affected) ? (affected as OsvRange[]) : [];
}

function coveredList(covered: unknown): { ecosystem: string; name: string }[] | null {
  if (!Array.isArray(covered)) return null;
  return covered.flatMap((c: unknown) =>
    typeof c === "object" &&
    c !== null &&
    "ecosystem" in c &&
    "name" in c &&
    typeof c.ecosystem === "string" &&
    typeof c.name === "string"
      ? [{ ecosystem: c.ecosystem, name: c.name }]
      : []
  );
}

/**
 * Whether the OSV record covers only the advisory's own package. A record covering several
 * stores one package's ranges (Advisory.affected), and not necessarily the stored package's
 * (the security scan projects it onto whichever package it was found for), so such alerts
 * are never resolved here. Unknown coverage counts as several.
 */
function coversOnlyOwnPackage(
  alert: Pick<ResolvableAlert, "ecosystem" | "packageName" | "covered">
): boolean {
  const covered = coveredList(alert.covered);
  if (covered === null) return false;
  return covered.every((c) => c.ecosystem === alert.ecosystem && c.name === alert.packageName);
}

/**
 * Whether the upload still has an install of the alert's package that the advisory may
 * affect. A version the ranges cannot place (a requirement, a floating action tag, no
 * semver form, no SEMVER range) cannot be ruled out, so it keeps the alert open.
 */
export function stillAffected(
  alert: Pick<ResolvableAlert, "packageId" | "affected">,
  installed: readonly InstalledDependency[]
): boolean {
  const installs = installed.filter((d) => d.packageId === alert.packageId);
  if (installs.some((d) => d.unresolved || d.constraint)) return true;
  return affectedInstalls(rangesOf(alert.affected), installs, (d) => d.version).length > 0;
}

/**
 * Which of a repo's alerts the upload resolves or reopens. An open alert resolves only
 * when the previous upload had its package (so the alert was about this package and not
 * another one the same OSV record covers) and the new upload carries the package's
 * ecosystem at all (an empty or partial upload, e.g. a lockfile that failed to parse,
 * says nothing about it), and the OSV record covers no other package
 * (`coversOnlyOwnPackage`). A package that is gone resolves only from a snapshot known to
 * be complete (`completeSnapshot`, the GitHub App): in a briff-scan upload a lockfile that
 * failed to parse looks the same as a removal. A resolved alert reopens when an affected
 * install is back.
 */
export function planAlertResolution(
  alerts: readonly ResolvableAlert[],
  previousPackageIds: ReadonlySet<string>,
  completeSnapshot: boolean,
  installed: readonly InstalledDependency[]
): ResolutionPlan {
  const ecosystems = new Set(installed.map((d) => d.ecosystem));
  const plan: ResolutionPlan = { resolve: [], reopen: [] };
  for (const alert of alerts) {
    const affected = stillAffected(alert, installed);
    if (alert.resolvedAt === null) {
      const stillInstalled = installed.some((d) => d.packageId === alert.packageId);
      if (
        !affected &&
        (stillInstalled || completeSnapshot) &&
        previousPackageIds.has(alert.packageId) &&
        ecosystems.has(alert.ecosystem) &&
        coversOnlyOwnPackage(alert)
      )
        plan.resolve.push(alert.id);
    } else if (affected) {
      plan.reopen.push(alert.id);
    }
  }
  return plan;
}
