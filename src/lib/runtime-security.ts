import { z } from "zod";

import { lineLifecycle, lowestSupportedLineAbove } from "./runtime-eol";

// Runtime security items (php.net advisories, GitHub security advisories of
// php/php-src, ...): what counts as one, the structured facts stored on
// `Item.metadata`, and which repos a fix applies to. Pure: shared by the
// collector, the deterministic urgent email and the weekly bulletin.

/** How runtime ids are written in sentences. */
export const RUNTIME_NAMES: Readonly<Record<string, string>> = {
  node: "Node.js",
  php: "PHP",
  python: "Python",
  go: "Go",
  ruby: "Ruby",
  java: "Java",
  dotnet: ".NET",
  rust: "Rust",
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  redis: "Redis",
  valkey: "Valkey",
  nginx: "nginx",
  deno: "Deno",
  bun: "Bun",
};

/** ItemTriage.reason of the rule row collect-sources writes for runtime security items. */
export const RUNTIME_SECURITY_REASON = "runtime-security";

/** Items older than this are history: bulletin only, never emailed or rematched for an email. */
export const URGENT_MAX_AGE_HOURS = 72;

export function runtimeName(id: string): string {
  return RUNTIME_NAMES[id] ?? id;
}

/**
 * Version segments that make a release line: Node.js, Java and PostgreSQL patch
 * per major (24.x, 21.x, 17.x); the others per minor (php 8.3.x, python 3.12.x).
 */
const LINE_DEPTH: Readonly<Record<string, number>> = { node: 1, java: 1, postgres: 1, debian: 1 };

export function lineDepth(runtime: string): number {
  return LINE_DEPTH[runtime] ?? 2;
}

export const runtimeItemMetaSchema = z.object({
  /** `advisory`: a GitHub security advisory; `announcement`: a feed post that matched the pattern. */
  kind: z.enum(["advisory", "announcement"]),
  ghsaId: z.string().optional(),
  /** Advisory `updated_at`: a later value means the advisory was edited (see reconcileAdvisories). */
  updatedAt: z.string().optional(),
  cveIds: z.array(z.string()).default([]),
  /** critical / high / medium / low; null when the source gives none. */
  severity: z.string().nullable().default(null),
  cvssScore: z.number().nullable().optional(),
  /** Versions that carry the fix, one per release line where the source lists several. */
  fixedVersions: z.array(z.string()).default([]),
  /** A single-release post ("PHP 8.4.27 Released!"): it only concerns its own release line. */
  lineSpecific: z.boolean().optional(),
  /**
   * Announced release time when the post names no fixed version yet: a full ISO time,
   * or `YYYY-MM-DD` when the post gives no time of day.
   */
  scheduledAt: z.string().optional(),
  /**
   * Release lines the post says are affected ("... fixed in the 22.x release line is HIGH"
   * → `22`). When present, a repo on another line is only listed when that line is past
   * end of life.
   */
  affectedLines: z.array(z.string()).optional(),
  /**
   * Set when an in-place update of the post moved fixedVersions from empty to non-empty
   * (src/sources/announcement-reconcile.ts): the "fix is out" follow-up keys on it.
   */
  fixAddedAt: z.string().optional(),
  affected: z
    .array(
      z.object({
        package: z.string(),
        vulnerable: z.string().nullable(),
        patched: z.string().nullable(),
      })
    )
    .optional(),
});

export type RuntimeItemMeta = z.infer<typeof runtimeItemMetaSchema>;

/** Item.metadata as runtime facts; null when absent or not in this shape. */
export function parseRuntimeMeta(value: unknown): RuntimeItemMeta | null {
  if (value === null || value === undefined) return null;
  const parsed = runtimeItemMetaSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Query lookback for runtime security items that may still be open: the rule triage window
 * (14 days) plus the urgent window, since a fix can land in place up to that long after the post.
 */
export const RUNTIME_ITEM_LOOKBACK_MS = (14 * 24 + URGENT_MAX_AGE_HOURS) * 3_600_000;

export interface RuntimeItemWindow {
  /** The item itself is younger than URGENT_MAX_AGE_HOURS. */
  itemRecent: boolean;
  /** Its fixed versions appeared in place less than URGENT_MAX_AGE_HOURS ago. */
  fixRecent: boolean;
}

/** Whether a runtime security item can still be emailed: young, or its fix is. */
export function runtimeItemWindow(
  item: { publishedAt: Date | null; createdAt: Date },
  meta: Pick<RuntimeItemMeta, "fixAddedAt"> | null,
  now: Date
): RuntimeItemWindow {
  const cutoff = now.getTime() - URGENT_MAX_AGE_HOURS * 3_600_000;
  const fixAt = meta?.fixAddedAt ? Date.parse(meta.fixAddedAt) : NaN;
  return {
    itemRecent: (item.publishedAt ?? item.createdAt).getTime() >= cutoff,
    fixRecent: Number.isFinite(fixAt) && fixAt >= cutoff,
  };
}

const TITLE_PATTERNS = [
  /\bsecurity\b/i,
  /\bCVE-\d{4}-\d{4,}\b/i,
  /\bvulnerab/i,
  /\badvisor(?:y|ies)\b/i,
  /\bout-of-(?:cycle|band)\b/i,
];
// The body is noisier (release notes mention "security" in passing), so only
// explicit markers count there.
const BODY_PATTERNS = [
  /\bCVE-\d{4}-\d{4,}\b/i,
  /\bsecurity (?:release|update|fix)(?:es|s)?\b/i,
  /\bout-of-(?:cycle|band)\b[^.]{0,40}\brelease/i,
];
const BODY_SCAN_CHARS = 4000;

/** Conservative test for a feed post of a security source that announces a security fix. */
export function isRuntimeSecurityText(title: string, body: string): boolean {
  if (TITLE_PATTERNS.some((p) => p.test(title))) return true;
  const head = body.slice(0, BODY_SCAN_CHARS);
  return BODY_PATTERNS.some((p) => p.test(head));
}

const VERSION_IN_TEXT = /(?<![\w.])v?(\d+\.\d+(?:\.\d+)?)(?![\w.]*\d)/g;

/**
 * `major.minor[.patch]` numbers in the text, in order, deduplicated. Calendar
 * versions (`2026.10.19`, a certifi release in Python's security list) are not
 * runtime releases and are left out.
 */
export function versionsIn(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(VERSION_IN_TEXT)]
        .map((m) => m[1])
        .filter((v) => Number(v.split(".")[0]) < 1000)
    ),
  ];
}

const FIX_SENTENCE = /\b(?:update|upgrade) to\b|\bfixed in\b|\bpatched in\b/i;

// "## Downloads and release details" followed by "- Node.js v22.23.4" bullets (Node.js
// security release posts once the releases are out).
const DOWNLOADS_SECTION = /^#*\s*downloads\b[^\n]*\n+((?:[ \t]*[-*][^\n]*(?:\n|$))+)/im;

/**
 * Fixed versions a post states: the versions in a release title ("PHP 8.3.36
 * Released!", "nginx-1.30.6 stable and nginx-1.31.7 mainline versions have been
 * released"), else those in a body sentence that says to update to them. A
 * pre-announcement names none.
 */
export function fixedVersionsFromText(
  title: string,
  body: string
): { versions: string[]; lineSpecific: boolean } {
  if (/\breleased?\b/i.test(title) && !/\bupcoming\b|\bpre-?announce/i.test(title)) {
    const versions = versionsIn(title);
    if (versions.length > 0) return { versions, lineSpecific: versions.length === 1 };
  }
  const downloads = DOWNLOADS_SECTION.exec(body);
  if (downloads) {
    const versions = versionsIn(downloads[1]).filter((v) => v.split(".").length === 3);
    if (versions.length > 0) return { versions, lineSpecific: false };
  }
  const sentences = body.slice(0, BODY_SCAN_CHARS).split(/(?<=[.!?])\s+/);
  const versions = sentences.filter((s) => FIX_SENTENCE.test(s)).flatMap(versionsIn);
  return { versions: [...new Set(versions)], lineSpecific: false };
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const MONTH = MONTHS.join("|");
const WEEKDAY = "(?:[a-z]+day,?\\s+)?";
const TIME = "(?:\\s+at\\s+(\\d{1,2}):(\\d{2})\\s*UTC)?";
const DAY_FIRST_DATE = `(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH}),?\\s+(\\d{4})${TIME}`;
const MONTH_FIRST_DATE = `(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})${TIME}`;
const SCHEDULED = `scheduled\\s+(?:for|on)\\s+${WEEKDAY}`;
const DAY_FIRST = new RegExp(`${SCHEDULED}${DAY_FIRST_DATE}`, "i");
const MONTH_FIRST = new RegExp(`${SCHEDULED}${MONTH_FIRST_DATE}`, "i");
// Node.js titles its posts by release day: "Wednesday, October 21, 2026 Security Releases".
const TITLE_DAY_FIRST = new RegExp(`^${WEEKDAY}${DAY_FIRST_DATE}\\s+security release`, "i");
const TITLE_MONTH_FIRST = new RegExp(`^${WEEKDAY}${MONTH_FIRST_DATE}\\s+security release`, "i");

/** An announced release time; `hasTime` is false when the post only names the day. */
export interface ScheduledRelease {
  at: Date;
  hasTime: boolean;
}

/**
 * "It is scheduled for Wednesday, 21 October 2026 at 14:00 UTC." in the body, or a
 * title that starts with the release day ("Wednesday, October 21, 2026 Security Releases").
 */
export function scheduledRelease(title: string, body: string): ScheduledRelease | null {
  const text = body.slice(0, BODY_SCAN_CHARS);
  const dayFirst = DAY_FIRST.exec(text) ?? TITLE_DAY_FIRST.exec(title);
  const monthFirst = dayFirst ? null : (MONTH_FIRST.exec(text) ?? TITLE_MONTH_FIRST.exec(title));
  const parts = dayFirst
    ? { day: dayFirst[1], month: dayFirst[2], year: dayFirst[3], h: dayFirst[4], m: dayFirst[5] }
    : monthFirst
      ? {
          day: monthFirst[2],
          month: monthFirst[1],
          year: monthFirst[3],
          h: monthFirst[4],
          m: monthFirst[5],
        }
      : null;
  if (!parts) return null;
  const month = MONTHS.indexOf(parts.month.toLowerCase());
  const date = new Date(
    Date.UTC(
      Number(parts.year),
      month,
      Number(parts.day),
      parts.h ? Number(parts.h) : 0,
      parts.m ? Number(parts.m) : 0
    )
  );
  return Number.isNaN(date.getTime()) ? null : { at: date, hasTime: Boolean(parts.h) };
}

function scheduledAtValue(release: ScheduledRelease): string {
  const iso = release.at.toISOString();
  return release.hasTime ? iso : iso.slice(0, 10);
}

const LINE_IMPACT = /\bissue fixed in the (\d+(?:\.\d+)?)\.x release line\b/gi;
const LINES_LIST =
  /((?:\b\d+(?:\.\d+)?\.x\b(?:,?\s*(?:and\s+)?)?)+)\s*(?:Node\.js\s+)?releases? lines\b/i;

/**
 * Release lines a post names as affected, newest first: the per-line impact list of a
 * Node.js security post ("The highest severity issue fixed in the 22.x release line is
 * HIGH."), else "new versions of the 26.x, 24.x, 22.x releases lines". Empty when none.
 */
export function affectedLinesFromText(body: string): string[] {
  const text = body.slice(0, BODY_SCAN_CHARS * 2);
  let lines = [...text.matchAll(LINE_IMPACT)].map((m) => m[1]);
  if (lines.length === 0) {
    const list = LINES_LIST.exec(text);
    lines = list ? [...list[1].matchAll(/(\d+(?:\.\d+)?)\.x/g)].map((m) => m[1]) : [];
  }
  return [...new Set(lines)].sort((a, b) => compareDotted(b, a));
}

const RELEASE_SEVERITY =
  /\bhighest severity issue fixed in this release is (critical|high|medium|low)\b/i;

function severityFromText(title: string, body: string): string | null {
  const stated = RELEASE_SEVERITY.exec(body.slice(0, BODY_SCAN_CHARS * 2));
  if (stated) return stated[1].toLowerCase();
  const text = `${title}\n${body.slice(0, 1500)}`;
  if (/\bcritical\b/i.test(text)) return "critical";
  if (/\bhigh[- ]severity\b|\bseverity:?\s*high\b/i.test(text)) return "high";
  return null;
}

/** Facts of a feed post that matched isRuntimeSecurityText. */
export function runtimeMetaFromText(title: string, body: string): RuntimeItemMeta {
  const text = `${title}\n${body}`;
  const cveIds = [...new Set([...text.matchAll(/\bCVE-\d{4}-\d{4,}\b/gi)].map((m) => m[0]))];
  const { versions, lineSpecific } = fixedVersionsFromText(title, body);
  const scheduled = versions.length === 0 ? scheduledRelease(title, body) : null;
  const affectedLines = lineSpecific ? [] : affectedLinesFromText(body);
  return {
    kind: "announcement",
    cveIds: cveIds.map((c) => c.toUpperCase()),
    severity: severityFromText(title, body),
    fixedVersions: versions,
    ...(lineSpecific ? { lineSpecific } : {}),
    ...(scheduled ? { scheduledAt: scheduledAtValue(scheduled) } : {}),
    ...(affectedLines.length > 0 ? { affectedLines } : {}),
  };
}

/** Same-hour email for critical/high and unknown severity; medium/low wait for the bulletin. */
export function emailsImmediately(meta: RuntimeItemMeta): boolean {
  const s = meta.severity?.toLowerCase() ?? null;
  return s === null || s === "critical" || s === "high";
}

function segments(version: string): number[] {
  return version.split(".").map(Number);
}

/** Numeric compare of dotted versions; missing segments count as 0. */
export function compareDotted(a: string, b: string): number {
  const x = segments(a);
  const y = segments(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** `8.3` for php 8.3.36 or 8.3; null when the version is too coarse to name a line (php `8`). */
export function releaseLineOf(runtime: string, version: string): string | null {
  const depth = lineDepth(runtime);
  const parts = /^\d+(?:\.\d+)*/.exec(version.trim())?.[0].split(".") ?? [];
  return parts.length >= depth ? parts.slice(0, depth).join(".") : null;
}

/** Whether the version names a patch level (php 8.3.20, node 22.11.0), not a floating line. */
export function isExactVersion(runtime: string, version: string): boolean {
  const parts = /^\d+(?:\.\d+)*/.exec(version.trim())?.[0].split(".") ?? [];
  return parts.length > lineDepth(runtime);
}

/** The fixed version on a release line, the highest one when the item lists several. */
export function fixOnLine(runtime: string, fixed: readonly string[], line: string): string | null {
  const onLine = fixed.filter((f) => releaseLineOf(runtime, f) === line).sort(compareDotted);
  return onLine.at(-1) ?? null;
}

export type RepoFixStatus =
  /** A fix exists on the repo's line and its version is not known to have it. */
  | { kind: "fix"; line: string; version: string }
  /** The repo's line is older than every fixed line: no fix there (out of support). */
  | { kind: "unsupported"; line: string; nearest: string | null }
  /**
   * The line is past end of life (src/lib/runtime-eol.ts) and gets no fix. `target`: the
   * lowest line still supported on `asOf` (`22`), as its fixed version when the item lists
   * one (`22.23.4`); without a supported line in the table, the lowest fixed version or
   * listed line above it; null when none is known. Informational: EOL lines have no on-line fix.
   */
  | { kind: "eol"; line: string; target: string | null }
  /** No fixed versions yet, or the repo's line is unknown: it may be affected. */
  | { kind: "unknown" }
  /** Already on a fixed version, or on a line the item does not concern. */
  | { kind: "unaffected" };

/**
 * What one declared runtime version means for an item. `normalized` is the
 * RepoRuntime value (`8.3`, `8.3.20`), null when the scanner could not derive one.
 */
export function repoFixStatus(
  runtime: string,
  meta: Pick<RuntimeItemMeta, "fixedVersions" | "lineSpecific" | "affectedLines">,
  normalized: string | null,
  asOf: Date = new Date()
): RepoFixStatus {
  const fixed = meta.fixedVersions.filter((f) => releaseLineOf(runtime, f) !== null);
  const line = normalized ? releaseLineOf(runtime, normalized) : null;
  const listed = meta.affectedLines && meta.affectedLines.length > 0 ? meta.affectedLines : null;
  const eol = (): RepoFixStatus => {
    const l = line as string;
    // The lowest supported line, never the line a post happens to name (a node 26-only
    // post must not tell a node 18 repo to jump to 26); its fixed version when known.
    const supported = lowestSupportedLineAbove(runtime, l, asOf);
    if (supported) {
      return { kind: "eol", line: l, target: fixOnLine(runtime, fixed, supported) ?? supported };
    }
    const newerFix = fixed
      .filter((f) => compareDotted(releaseLineOf(runtime, f) as string, l) > 0)
      .sort(compareDotted)[0];
    const newerLine = (listed ?? []).filter((x) => compareDotted(x, l) > 0).sort(compareDotted)[0];
    return { kind: "eol", line: l, target: newerFix ?? newerLine ?? null };
  };
  const isListed = (l: string) => listed?.some((x) => compareDotted(x, l) === 0) ?? false;
  if (fixed.length === 0) {
    if (!line || meta.lineSpecific) return { kind: "unknown" };
    const lifecycle = lineLifecycle(runtime, line, asOf);
    if (lifecycle === "eol" && !isListed(line)) return eol();
    // A line we cannot place (newer than the EOL table) is still emailed.
    if (listed && !isListed(line) && lifecycle === "supported") return { kind: "unaffected" };
    return { kind: "unknown" };
  }
  if (!normalized || !line) return { kind: "unknown" };
  const fix = fixOnLine(runtime, fixed, line);
  if (fix) {
    if (isExactVersion(runtime, normalized) && compareDotted(normalized, fix) >= 0) {
      return { kind: "unaffected" };
    }
    return { kind: "fix", line, version: fix };
  }
  // A line the post does not list: end-of-life lines are still affected ("End-of-Life
  // versions are always affected"), lines newer than the EOL table may be, supported ones
  // are not. "Not affected" is only ever said of a supported line.
  const lifecycle = lineLifecycle(runtime, line, asOf);
  if (lifecycle === "eol") return eol();
  if (lifecycle === "unknown") return { kind: "unknown" };
  if (meta.lineSpecific) return { kind: "unaffected" };
  if (listed && !isListed(line)) return { kind: "unaffected" };
  const lines = fixed.map((f) => releaseLineOf(runtime, f) as string).sort(compareDotted);
  if (compareDotted(line, lines[0]) < 0) {
    const major = line.split(".")[0];
    // Nearest fix on the same major only: never suggest a major upgrade.
    const nearest = fixed.filter((f) => f.split(".")[0] === major).sort(compareDotted)[0] ?? null;
    return { kind: "unsupported", line, nearest };
  }
  return { kind: "unaffected" };
}

/** The union of fixed versions across items, highest per release line. */
export function mergeFixedVersions(
  runtime: string,
  lists: readonly (readonly string[])[]
): string[] {
  const byLine = new Map<string, string>();
  for (const v of lists.flat()) {
    const line = releaseLineOf(runtime, v);
    if (!line) continue;
    const current = byLine.get(line);
    if (!current || compareDotted(v, current) > 0) byLine.set(line, v);
  }
  return [...byLine.values()].sort((a, b) => compareDotted(b, a));
}
