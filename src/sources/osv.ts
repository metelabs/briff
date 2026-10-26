import semver from "semver";
import { z } from "zod";

import { fetchJson } from "@/lib/platforms/fetch-with-retry";
import { cvssLevel, type SeverityLevel } from "@/security/cvss";
import { normalizePackageName, normalizeVersion, type Ecosystem } from "@scan/ecosystems";

// OSV.dev adapter (plan §7.4): query by ecosystem + name + INSTALLED version in
// batches, then fetch full records for the ids that came back.

const OSV_API = "https://api.osv.dev/v1";
export const OSV_BATCH_LIMIT = 1000;

const batchResponseSchema = z.object({
  results: z.array(
    z.object({
      vulns: z.array(z.object({ id: z.string(), modified: z.string().optional() })).optional(),
      next_page_token: z.string().optional(),
    })
  ),
});

const eventSchema = z
  .object({
    introduced: z.string().optional(),
    fixed: z.string().optional(),
    last_affected: z.string().optional(),
    limit: z.string().optional(),
  })
  .loose();

const rangeSchema = z.object({ type: z.string(), events: z.array(eventSchema) }).loose();

export const osvVulnSchema = z
  .object({
    id: z.string(),
    summary: z.string().optional(),
    details: z.string().optional(),
    aliases: z.array(z.string()).optional(),
    modified: z.string(),
    published: z.string().optional(),
    withdrawn: z.string().optional(),
    severity: z.array(z.object({ type: z.string(), score: z.string() })).optional(),
    database_specific: z.object({ severity: z.string().optional() }).loose().optional(),
    references: z.array(z.object({ type: z.string(), url: z.string() })).optional(),
    affected: z
      .array(
        z
          .object({
            package: z.object({ ecosystem: z.string(), name: z.string() }).loose(),
            ranges: z.array(rangeSchema).optional(),
            versions: z.array(z.string()).optional(),
          })
          .loose()
      )
      .default([]),
  })
  .loose();

export type OsvVuln = z.infer<typeof osvVulnSchema>;
export type OsvRange = z.infer<typeof rangeSchema>;

export interface OsvQuery {
  name: string;
  version: string;
  constraint?: boolean;
  /** OSV ecosystem of the package; npm when absent. */
  ecosystem?: Ecosystem;
}

export interface OsvHit {
  id: string;
  modified: string | null;
}

/** Vulnerability ids per query, same order as the input. Splits into API-sized batches. */
export async function queryOsvBatch(queries: OsvQuery[]): Promise<string[][]> {
  const hits = await queryOsvBatchHits(queries);
  return hits.map((list) => list.map((h) => h.id));
}

/** The querybatch body entry for one query: the package's own ecosystem, never a run-wide one. */
export function osvQueryOf(q: OsvQuery): {
  package: { ecosystem: Ecosystem; name: string };
  version?: string;
  commit?: string;
} {
  const pkg = { ecosystem: q.ecosystem ?? "npm", name: q.name };
  if (q.ecosystem === "GitHub Actions") {
    if (q.constraint) return { package: pkg };
    if (/^[a-f0-9]{40}$/i.test(q.version)) return { package: pkg, commit: q.version };
  }
  return { package: { ecosystem: q.ecosystem ?? "npm", name: q.name }, version: q.version };
}

/** Like queryOsvBatch, with each record's `modified` timestamp (to skip unchanged refetches). */
export async function queryOsvBatchHits(
  queries: OsvQuery[],
  heartbeat: () => Promise<void> = async () => undefined
): Promise<OsvHit[][]> {
  const out: OsvHit[][] = [];
  for (let i = 0; i < queries.length; i += OSV_BATCH_LIMIT) {
    await heartbeat();
    const slice = queries.slice(i, i + OSV_BATCH_LIMIT);
    const res = await fetchJson("osv:querybatch", `${OSV_API}/querybatch`, batchResponseSchema, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries: slice.map(osvQueryOf) }),
      timeoutMs: 30_000,
    });
    for (const [index, result] of res.results.entries()) {
      const records = [...(result.vulns ?? [])];
      let token = result.next_page_token;
      while (token) {
        await heartbeat();
        const page = await fetchJson(
          "osv:query-page",
          `${OSV_API}/query`,
          batchResponseSchema.shape.results.element,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...osvQueryOf(slice[index]), page_token: token }),
            timeoutMs: 30_000,
          }
        );
        records.push(...(page.vulns ?? []));
        token = page.next_page_token;
      }
      const hits = records.map((v) => ({ id: v.id, modified: v.modified ?? null }));
      const query = slice[index];
      if (query.ecosystem === "GitHub Actions" && query.constraint) {
        const accepted: OsvHit[] = [];
        for (const hit of hits) {
          await heartbeat();
          const vuln = await fetchOsvVuln(hit.id);
          if (!vuln.withdrawn && actionConstraintAffected(vuln, query.name, query.version))
            accepted.push(hit);
        }
        out.push(accepted);
      } else out.push(hits);
    }
  }
  return out;
}

export async function fetchOsvVuln(id: string): Promise<OsvVuln> {
  return fetchJson(`osv:vuln:${id}`, `${OSV_API}/vulns/${encodeURIComponent(id)}`, osvVulnSchema, {
    timeoutMs: 15_000,
  });
}

export interface AdvisoryFields {
  osvId: string;
  summary: string | null;
  affected: OsvRange[];
  severity: string | null;
  fixedVersion: string | null;
  url: string;
  publishedAt: Date | null;
  modifiedAt: Date | null;
}

/**
 * An `ECOSYSTEM` range of Packagist as the `SEMVER` range the version checks read, when every
 * event version has a semver form that means the same release to Composer (`v6.4.3`, `6.4`).
 * npm and Go ranges are SEMVER already; a range that does not convert is kept as it is (and
 * so are the package's other ranges, see rangesFor).
 */
export function comparableRange(range: OsvRange, ecosystem: Ecosystem): OsvRange {
  if (range.type !== "ECOSYSTEM" || ecosystem === "npm") return range;
  const events = range.events.map((event) => {
    const out: typeof event = { ...event };
    for (const key of ["introduced", "fixed", "last_affected", "limit"] as const) {
      const value = event[key];
      if (value === undefined || value === "0" || value === "*") continue;
      out[key] = normalizeVersion(ecosystem, value);
    }
    return out;
  });
  const valid = events.every((event) =>
    (["introduced", "fixed", "last_affected", "limit"] as const).every((key) => {
      const value = event[key];
      return value === undefined || value === "0" || value === "*" || semver.valid(value) !== null;
    })
  );
  return valid ? { ...range, type: "SEMVER", events } : range;
}

/**
 * The package's ranges, converted all or nothing: when one ECOSYSTEM range has no semver
 * form, every range stays as OSV wrote it. Converting only the others would let the
 * version checks, which read SEMVER ranges only, rule out installs the unconverted range
 * covers; without any SEMVER range every install counts as affected and no fix is named.
 */
function rangesFor(vuln: OsvVuln, packageName: string, ecosystem: Ecosystem): OsvRange[] {
  const wanted = normalizePackageName(ecosystem, packageName);
  const ranges = vuln.affected
    .filter(
      (a) =>
        a.package.ecosystem.toLowerCase() === ecosystem.toLowerCase() &&
        normalizePackageName(ecosystem, a.package.name) === wanted
    )
    .flatMap((a) => a.ranges ?? [])
    // A GIT range's events are commit hashes, not releases (PYSEC records carry one next to
    // the ECOSYSTEM range); only release ranges place an install or name a fix.
    .filter((range) => range.type === "ECOSYSTEM" || range.type === "SEMVER");
  const converted = ranges.map((range) => comparableRange(range, ecosystem));
  return converted.some((range) => range.type === "ECOSYSTEM") ? ranges : converted;
}

/** LOW/MODERATE/HIGH/CRITICAL for a label (GitHub's, or MEDIUM); null for anything else. */
export function severityLevelOf(label: string | null | undefined): SeverityLevel | null {
  const word = label?.trim().toUpperCase();
  if (word === "MEDIUM") return "MODERATE";
  return word === "LOW" || word === "MODERATE" || word === "HIGH" || word === "CRITICAL"
    ? word
    : null;
}

// GitHub rates by the CVSS 4.0 vector when a record has one (GHSA-gmj6-6f8f-6699: v3 8.8,
// v4 5.4, rated moderate), so it is scored first.
const VECTOR_ORDER = ["CVSS_V4", "CVSS_V3"];

/**
 * The record's level: GitHub's label (`database_specific.severity`) when present, else the
 * score of its CVSS 4.0 or 3.x vector in GitHub's bands, else null (an alias may know it).
 */
export function severityOf(vuln: OsvVuln): SeverityLevel | null {
  const label = severityLevelOf(vuln.database_specific?.severity);
  if (label) return label;
  const vectors = [...(vuln.severity ?? [])].sort((a, b) => rank(a.type) - rank(b.type));
  for (const { score } of vectors) {
    const level = cvssLevel(score);
    if (level) return level;
  }
  return null;
}

function rank(type: string): number {
  const i = VECTOR_ORDER.indexOf(type);
  return i < 0 ? VECTOR_ORDER.length : i;
}

/** Projects an OSV record onto one package, as stored in the Advisory table. */
export function toAdvisoryFields(
  vuln: OsvVuln,
  packageName: string,
  ecosystem: Ecosystem = "npm"
): AdvisoryFields {
  const affected = rangesFor(vuln, packageName, ecosystem);
  const fixed = [
    ...new Set(affected.flatMap((r) => r.events.flatMap((e) => (e.fixed ? [e.fixed] : [])))),
  ];
  const advisoryRef = vuln.references?.find((r) => r.type === "ADVISORY")?.url;
  const date = (v: string | undefined) => (v ? new Date(v) : null);
  return {
    osvId: vuln.id,
    summary: vuln.summary ?? null,
    affected,
    severity: severityOf(vuln),
    fixedVersion: fixed.length > 0 ? fixed.join(", ") : null,
    url: advisoryRef ?? `https://osv.dev/vulnerability/${vuln.id}`,
    publishedAt: date(vuln.published),
    modifiedAt: date(vuln.modified),
  };
}

/** The fix for one installed version: the `fixed` event of the SEMVER range containing it. */
export function fixedVersionFor(ranges: OsvRange[], installed: string): string | null {
  if (!semver.valid(installed)) return null;
  for (const range of ranges) {
    if (range.type !== "SEMVER") continue;
    let introduced: string | null = null;
    for (const event of range.events) {
      if (event.introduced !== undefined) introduced = event.introduced;
      if (event.fixed !== undefined && introduced !== null) {
        const lower = introduced === "0" ? "0.0.0-0" : introduced;
        const inRange = semver.gte(installed, lower) && semver.lt(installed, event.fixed);
        if (inRange) return event.fixed;
        introduced = null;
      }
    }
  }
  return null;
}

/**
 * Whether an installed version falls in any SEMVER range: from an `introduced` event up to
 * the next `fixed` or `limit` (exclusive) or `last_affected` (inclusive), or open-ended.
 */
export function isAffected(ranges: OsvRange[], installed: string): boolean {
  if (!semver.valid(installed)) return false;
  for (const range of ranges) {
    if (range.type !== "SEMVER") continue;
    let introduced: string | null = null;
    for (const event of range.events) {
      if (event.introduced !== undefined)
        introduced = event.introduced === "0" ? "0.0.0-0" : event.introduced;
      const end = event.fixed ?? event.limit ?? event.last_affected;
      const inclusive = end !== undefined && end === event.last_affected;
      if (end !== undefined && introduced !== null) {
        // `limit: "*"` is OSV's explicit "no upper bound".
        const below =
          end === "*" || (inclusive ? semver.lte(installed, end) : semver.lt(installed, end));
        if (semver.gte(installed, introduced) && below) return true;
        introduced = null;
      }
    }
    if (introduced !== null && semver.gte(installed, introduced)) return true;
  }
  return false;
}

/**
 * The installs an advisory affects. Without any SEMVER range nothing can be ruled out,
 * so every install counts (its fix then resolves to null). Neither can an installed version
 * without a semver form (a Composer `2.0.0.1`, a PEP 440 `1.0.post1`): OSV reported it, so it
 * counts, and its fix resolves to null too.
 */
export function affectedInstalls<T>(
  ranges: OsvRange[],
  installs: readonly T[],
  versionOf: (install: T) => string
): T[] {
  if (!ranges.some((range) => range.type === "SEMVER")) return [...installs];
  return installs.filter((install) => {
    const version = versionOf(install);
    return !semver.valid(version) || isAffected(ranges, version);
  });
}

/** A floating ref is affected only if an advisory covers its entire release interval. */
export function actionConstraintAffected(vuln: OsvVuln, name: string, ref: string): boolean {
  const match = /^v?(\d+)(?:\.(\d+))?$/.exec(ref);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = match[2] === undefined ? null : Number(match[2]);
  const lower = `${major}.${minor ?? 0}.0`;
  const upper = minor === null ? `${major + 1}.0.0` : `${major}.${minor + 1}.0`;
  const ranges = rangesFor(vuln, name, "GitHub Actions");
  for (const range of ranges) {
    if (range.type !== "SEMVER") continue;
    let start: string | null = null;
    for (const event of range.events) {
      if (event.introduced !== undefined)
        start = event.introduced === "0" ? "0.0.0" : event.introduced;
      const end = event.fixed ?? event.limit ?? event.last_affected;
      if (end !== undefined && start !== null) {
        if (
          semver.valid(start) &&
          semver.lte(start, lower) &&
          (end === "*" || (semver.valid(end) && semver.gte(end, upper)))
        )
          return true;
        start = null;
      }
    }
    if (start && semver.valid(start) && semver.lte(start, lower)) return true;
  }
  return false;
}
