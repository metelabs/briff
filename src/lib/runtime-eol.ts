// End-of-life dates per release line, so a security item can say "node 18 will not
// get this fix" instead of a fix command for a line the advisory does not list.
// Static on purpose: dates come from https://endoflife.date (checked 23 Oct 2026),
// which is the source to read live once this table goes stale. Lines are keyed like
// releaseLineOf() (node/postgres per major, the rest per minor). For a runtime in the
// table, a line below the newest listed one that has no entry is end-of-life (gaps are
// history: node 17, php 7.3); a line above the newest one is "unknown" (not released when
// the table was written), and callers treat it as possibly affected.

const EOL: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  node: {
    "14": "2023-04-30",
    "15": "2021-06-01",
    "16": "2023-09-11",
    "17": "2022-06-01",
    "18": "2025-04-30",
    "19": "2023-06-01",
    "20": "2026-04-30",
    "21": "2024-06-01",
    "22": "2027-04-30",
    "23": "2025-06-01",
    "24": "2028-04-30",
    "25": "2026-06-01",
    "26": "2029-04-30",
  },
  php: {
    "7.4": "2022-11-28",
    "8.0": "2023-11-26",
    "8.1": "2025-12-31",
    "8.2": "2026-12-31",
    "8.3": "2027-12-31",
    "8.4": "2028-12-31",
    "8.5": "2029-12-31",
  },
  python: {
    "3.8": "2024-10-07",
    "3.9": "2025-10-31",
    "3.10": "2026-10-31",
    "3.11": "2027-10-31",
    "3.12": "2028-10-31",
    "3.13": "2029-10-31",
    "3.14": "2030-10-31",
  },
  ruby: {
    "3.0": "2024-04-23",
    "3.1": "2025-03-31",
    "3.2": "2026-03-31",
    "3.3": "2027-03-31",
    "3.4": "2028-03-31",
  },
  go: {
    "1.22": "2025-02-11",
    "1.23": "2025-08-12",
    "1.24": "2026-02-10",
    "1.25": "2026-08-11",
    "1.26": "2027-02-09",
  },
  postgres: {
    "12": "2024-11-21",
    "13": "2025-11-13",
    "14": "2026-11-12",
    "15": "2027-11-11",
    "16": "2028-11-09",
    "17": "2029-11-08",
    "18": "2030-11-14",
  },
};

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
  return EOL[runtime]?.[line] ?? null;
}

/**
 * `eol`: past end of life on `asOf`. `supported`: a listed line still in support, or any
 * line of a runtime the table does not cover (no claim either way). `unknown`: a line
 * newer than every line the table knows for the runtime.
 */
export type LineLifecycle = "eol" | "supported" | "unknown";

export function lineLifecycle(runtime: string, line: string, asOf: Date): LineLifecycle {
  const table = EOL[runtime];
  if (!table) return "supported";
  const date = table[line];
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
  const table = EOL[runtime];
  if (!table) return null;
  return (
    Object.keys(table)
      .filter((l) => compareLines(l, line) > 0 && lineLifecycle(runtime, l, asOf) === "supported")
      .sort(compareLines)[0] ?? null
  );
}
