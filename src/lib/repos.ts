import { lineLifecycle } from "@/lib/runtime-eol";
import { isVersionRange, runtimeVersionLabel } from "@/lib/runtime-range";
import { releaseLineOf } from "@/lib/runtime-security";
import { ecosystemLabel } from "@scan/ecosystems";
import { isConstraintRow } from "@scan/runtimes";

export const NEW_REPO_DAYS = 7;

/** "New" badge: seen in the last week and never toggled by the user. */
export function isNewRepo(
  repo: { firstSeenAt: Date; includedChangedAt: Date | null },
  now: Date = new Date()
): boolean {
  return (
    repo.includedChangedAt === null &&
    now.getTime() - repo.firstSeenAt.getTime() < NEW_REPO_DAYS * 86_400_000
  );
}

export interface RuntimeRow {
  name: string;
  version: string;
  normalized: string | null;
  source: string;
  unresolved: boolean;
  /** A constraint (`engines.node >=20`): shown, never judged end-of-life. Derived when absent. */
  constraint?: boolean | null;
}

export interface RuntimeChip {
  /** Runtime id (`node`), for the end-of-life check. */
  name: string;
  /**
   * The release line is past end of life (runtime-eol.ts), by a concrete row: a constraint
   * (`node 20+` from `engines.node >=20`) says what is allowed, not what runs.
   */
  eol: boolean;
  /** `php 8.3`, `node 20+` for a constraint, or `image ghcr.io/acme/tools:2.1` for an unmapped image. */
  label: string;
  /** `Dockerfile`, or `.nvmrc +2` when several files say the same. */
  sources: string;
  /** Every file with its raw text, for the hover title. */
  detail: string;
  unresolved: boolean;
}

/** `golang@sha256:<64 hex>` -> `golang@sha256:0123456789ab…`; the stored text keeps the full digest. */
function shortDigest(version: string): string {
  return version.replace(/@(sha256:[0-9a-f]{12})[0-9a-f]+/i, "@$1…");
}

/** One chip per runtime and shown version; mapped runtimes first, unmapped images last. */
export function runtimeChips(rows: readonly RuntimeRow[], asOf: Date = new Date()): RuntimeChip[] {
  const groups = new Map<string, { image: boolean; label: string; rows: RuntimeRow[] }>();
  for (const row of rows) {
    const shown =
      !row.unresolved && isVersionRange(row.version)
        ? runtimeVersionLabel(row)
        : (row.normalized ?? shortDigest(row.version));
    const label = `${row.name} ${shown}`;
    const group = groups.get(label) ?? { image: row.name === "image", label, rows: [] };
    group.rows.push(row);
    groups.set(label, group);
  }
  return [...groups.values()]
    .sort((a, b) => Number(a.image) - Number(b.image) || a.label.localeCompare(b.label))
    .map(({ label, rows: list }) => {
      const files = [...new Set(list.map((r) => r.source))].sort();
      const first = list[0];
      const eol = list.some((r) => {
        if (isConstraintRow(r)) return false;
        const line = releaseLineOf(r.name, r.normalized ?? r.version);
        return line !== null && lineLifecycle(r.name, line, asOf) === "eol";
      });
      return {
        name: first.name,
        eol,
        label,
        sources: files.length > 1 ? `${files[0]} +${files.length - 1}` : files[0],
        detail: list
          .map((r) => `${r.source}: ${r.version}${isConstraintRow(r) ? " (constraint)" : ""}`)
          .join("\n"),
        unresolved: list.every((r) => r.unresolved),
      };
    });
}

/** Dependency counts of one repo in one ecosystem. */
export interface EcosystemCount {
  ecosystem: string;
  direct: number;
  total: number;
}

/**
 * The Repos page's dependency line, one part per ecosystem: `12 direct · 340 total` alone for
 * an npm-only repo (as before other ecosystems), else each part names its ecosystem, npm first:
 * [`npm 12 direct · 340 total`, `Composer 8 direct · 61 total`].
 */
export function dependencySummary(counts: readonly EcosystemCount[]): string[] {
  const used = counts.filter((c) => c.total > 0);
  const text = (c: Pick<EcosystemCount, "direct" | "total">) =>
    `${c.direct} direct · ${c.total} total`;
  if (used.length === 0) return [text({ direct: 0, total: 0 })];
  if (used.length === 1 && used[0].ecosystem === "npm") return [text(used[0])];
  return [...used]
    .sort(
      (a, b) =>
        Number(b.ecosystem === "npm") - Number(a.ecosystem === "npm") ||
        a.ecosystem.localeCompare(b.ecosystem)
    )
    .map((c) => `${ecosystemLabel(c.ecosystem)} ${text(c)}`);
}
