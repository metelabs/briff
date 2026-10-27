import { FALLBACK_EOL } from "./runtime-eol-fallback";

export interface LifecycleRow {
  product: string;
  cycle: string;
  eol: string | boolean;
  latest: string | null;
  lts: string | boolean | null;
  support: string | boolean | null;
}

export function fallbackLifecycleRows(): LifecycleRow[] {
  return Object.entries(FALLBACK_EOL).flatMap(([product, cycles]) =>
    Object.entries(cycles).map(([cycle, eol]) => ({
      product,
      cycle,
      eol,
      latest: null,
      lts: null,
      support: null,
    }))
  );
}

let fetched: readonly LifecycleRow[] = [];

export function setLifecycleRows(rows: readonly LifecycleRow[]): void {
  fetched = rows;
}

function lifecycleTable(runtime: string): Readonly<Record<string, string | boolean>> | undefined {
  const rows = fetched.filter((r) => r.product === runtime);
  return rows.length
    ? Object.fromEntries(rows.map((r) => [r.cycle, r.eol]))
    : FALLBACK_EOL[runtime];
}

// Local copy of compareDotted: runtime-security imports this module.
function compareLines(a: string, b: string): number {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** End-of-life date of a release line, null when the table does not know the runtime or line. */
export function endOfLifeDate(runtime: string, line: string): string | null {
  const table = lifecycleTable(runtime);
  const value = table?.[line] ?? table?.[line.split(".")[0]];
  return typeof value === "string" ? value : null;
}

/**
 * `eol`: past end of life on `asOf`. `supported`: a listed line still in support, or any
 * line of a runtime the table does not cover (no claim either way). `unknown`: a line
 * newer than every line the table knows for the runtime.
 */
export type LineLifecycle = "eol" | "supported" | "unknown";

export function lineLifecycle(runtime: string, line: string, asOf: Date): LineLifecycle {
  const table = lifecycleTable(runtime);
  if (!table) return "supported";
  const date = table[line] ?? table[line.split(".")[0]];
  if (typeof date === "boolean") return date ? "eol" : "supported";
  if (date) return new Date(`${date}T23:59:59Z`).getTime() < asOf.getTime() ? "eol" : "supported";
  const newest = Object.keys(table).sort(compareLines).at(-1) as string;
  return compareLines(line, newest) < 0 ? "eol" : "unknown";
}

/** Whether a release line is past end of life on `asOf`; false for runtimes the table does not cover. */
export function isEndOfLife(runtime: string, line: string, asOf: Date): boolean {
  return lineLifecycle(runtime, line, asOf) === "eol";
}

/**
 * The lowest line above `line` still supported on `asOf`: where an end-of-life line moves to.
 * Null when the table does not cover the runtime or knows no such line.
 */
export function lowestSupportedLineAbove(runtime: string, line: string, asOf: Date): string | null {
  const table = lifecycleTable(runtime);
  if (!table) return null;
  return (
    Object.keys(table)
      .filter((l) => compareLines(l, line) > 0 && lineLifecycle(runtime, l, asOf) === "supported")
      .sort(compareLines)[0] ?? null
  );
}
