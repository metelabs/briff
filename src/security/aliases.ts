import { severityRank } from "@/security/plan";
import { toAdvisoryFields, type AdvisoryFields, type OsvVuln } from "@/sources/osv";
import { isEcosystem, normalizePackageName, type Ecosystem } from "@scan/ecosystems";

// One vulnerability, one Advisory. OSV answers a package query with every database's entry
// for it: GitHub's GHSA next to the Go (GO-*) or PyPI (PYSEC-*) one, linked through
// `aliases`. They are collapsed here into one canonical record. `related` is not followed:
// it links different vulnerabilities (distribution advisories, fixes in other packages).

/** GHSA first (it carries GitHub's level and summary), then the CVE, then a native id. */
export function idRank(id: string): number {
  if (id.startsWith("GHSA-")) return 0;
  if (id.startsWith("CVE-")) return 1;
  return 2;
}

export const byIdRank = (a: string, b: string) => idRank(a) - idRank(b) || a.localeCompare(b);

/** The ids a record answers to: its own and its aliases. */
export function idsOf(vuln: Pick<OsvVuln, "id" | "aliases">): string[] {
  return [vuln.id, ...(vuln.aliases ?? [])];
}

/**
 * Records that share an id, directly or through a chain (GO-* -> CVE <- GHSA), in one
 * group each. Groups keep the input order of their first record.
 */
export function aliasGroups<T extends Pick<OsvVuln, "id" | "aliases">>(
  records: readonly T[]
): T[][] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    if (!parent.has(id)) parent.set(id, id);
    let root = id;
    for (let up = parent.get(root); up !== undefined && up !== root; up = parent.get(root)) {
      root = up;
    }
    parent.set(id, root);
    return root;
  };
  for (const record of records) {
    const [first, ...rest] = idsOf(record);
    for (const id of rest) {
      const a = find(first);
      const b = find(id);
      if (a !== b) parent.set(b, a);
    }
    find(first);
  }
  const groups = new Map<string, T[]>();
  for (const record of records) {
    const root = find(record.id);
    groups.set(root, [...(groups.get(root) ?? []), record]);
  }
  return [...groups.values()];
}

export interface MergedAdvisory extends AdvisoryFields {
  /** Every other id of the vulnerability, canonical rank order (GHSA, CVE, then native). */
  aliases: string[];
  /** Each merged record's own OSV `modified`. */
  recordsModified: Record<string, string>;
  /** Every package the merged records cover (one OSV record can cover several). */
  packages: CoveredPackage[];
}

export interface CoveredPackage {
  ecosystem: string;
  name: string;
}

/** The packages a group's records list under `affected`, names stored the way Package rows are. */
export function coveredPackages(group: readonly Pick<OsvVuln, "affected">[]): CoveredPackage[] {
  const seen = new Map<string, CoveredPackage>();
  for (const vuln of group) {
    for (const { package: pkg } of vuln.affected) {
      if (!pkg || !isEcosystem(pkg.ecosystem)) continue;
      const name = normalizePackageName(pkg.ecosystem, pkg.name);
      seen.set(`${pkg.ecosystem}\0${name}`, { ecosystem: pkg.ecosystem, name });
    }
  }
  return [...seen.values()];
}

/**
 * One alias group projected onto a package. The canonical record (best `idRank`) gives the
 * id, summary, ranges and link; what it lacks comes from the others in rank order: a level
 * (else the highest of theirs), a summary, ranges and fixed versions.
 */
export function mergeAliasGroup(
  group: readonly OsvVuln[],
  packageName: string,
  ecosystem: Ecosystem
): MergedAdvisory {
  const sorted = [...group].sort((a, b) => byIdRank(a.id, b.id));
  const [canonical, ...others] = sorted.map((vuln) =>
    toAdvisoryFields(vuln, packageName, ecosystem)
  );
  const withRanges = [canonical, ...others].find((f) => f.affected.length > 0) ?? canonical;
  const inherited = others
    .map((f) => f.severity)
    .sort((a, b) => severityRank(b) - severityRank(a))[0];
  const modified = sorted.flatMap((v) => (v.modified ? [new Date(v.modified).getTime()] : []));
  const aliases = [...new Set(sorted.flatMap(idsOf))]
    .filter((id) => id !== canonical.osvId)
    .sort(byIdRank);
  return {
    ...canonical,
    summary: canonical.summary ?? others.find((f) => f.summary)?.summary ?? null,
    severity: canonical.severity ?? inherited ?? null,
    affected: withRanges.affected,
    fixedVersion: withRanges.fixedVersion,
    modifiedAt: modified.length > 0 ? new Date(Math.max(...modified)) : null,
    aliases,
    recordsModified: Object.fromEntries(sorted.map((v) => [v.id, v.modified])),
    packages: coveredPackages(sorted),
  };
}
