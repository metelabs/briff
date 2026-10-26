import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import {
  mergeDeclarations,
  normalizePackageName,
  type Ecosystem,
  type PackageManager,
} from "@scan/ecosystems";
import { isConstraintRow } from "@scan/runtimes";

import type { ScanBody, ScanDependency, ScanRuntime } from "./schema";

export interface RepoIngestResult {
  name: string;
  created: boolean;
  dependencies: number;
  direct: number;
  /** Runtime rows stored; null when the upload carried no `runtimes` (older scanner). */
  runtimes: number | null;
  /** A runtime or a runtime version appeared that the repo did not declare before. */
  runtimesChanged: boolean;
}

/** A dependency row as stored: ecosystem resolved (npm when absent), name normalised. */
export interface IngestDependency {
  ecosystem: Ecosystem;
  name: string;
  version: string;
  direct: boolean;
  dev: boolean;
  manager: PackageManager | null;
  group: string | null;
  requirement: string | null;
  project: string | null;
  constraint: boolean;
  metadata: ScanDependency["metadata"];
  unresolved: boolean;
}

/** The Package key, `(ecosystem, name)`. */
export const packageKey = (ecosystem: string, name: string) => `${ecosystem}\0${name}`;

/**
 * Same package+version listed twice (e.g. from two lockfiles): direct wins. The package is
 * (ecosystem, name): an npm and a Packagist package of the same name stay apart.
 */
export function dedupeDependencies(deps: ScanDependency[]): IngestDependency[] {
  const byKey = new Map<string, IngestDependency>();
  for (const dep of deps) {
    const ecosystem = dep.ecosystem ?? "npm";
    const row: IngestDependency = {
      ecosystem,
      name: normalizePackageName(ecosystem, dep.name),
      version: dep.version,
      direct: dep.direct,
      dev: dep.dev ?? false,
      manager: dep.manager ?? null,
      group: dep.group ?? null,
      requirement: dep.requirement ?? null,
      project: dep.project ?? null,
      constraint: ecosystem === "GitHub Actions" && /^v?\d+(?:\.\d+)?$/.test(dep.version),
      metadata: dep.metadata,
      unresolved: dep.unresolved ?? false,
    };
    const key = `${packageKey(ecosystem, row.name)}@${dep.version}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, row);
      continue;
    }
    // Every section either row declares is kept; development-only while none is production.
    const merged = mergeDeclarations(prev, row);
    prev.dev = merged.dev;
    prev.group = merged.group ?? null;
    prev.requirement ??= row.requirement;
    prev.project ??= row.project;
    prev.direct ||= row.direct;
    prev.manager ??= row.manager;
  }
  return [...byKey.values()];
}

/** Whether `next` declares a runtime (name + version) that `previous` did not. */
export function runtimesAdded(
  previous: readonly Pick<ScanRuntime, "name" | "version" | "normalized">[],
  next: readonly Pick<ScanRuntime, "name" | "version" | "normalized">[]
): boolean {
  const key = (r: Pick<ScanRuntime, "name" | "version" | "normalized">) =>
    `${r.name}\0${r.normalized ?? r.version}`;
  const before = new Set(previous.map(key));
  return next.some((r) => !before.has(key(r)));
}

/** One row per (name, source, version), the unique key of RepoRuntime. */
export function dedupeRuntimes(runtimes: ScanRuntime[]): ScanRuntime[] {
  const byKey = new Map<string, ScanRuntime>();
  for (const runtime of runtimes) {
    byKey.set(`${runtime.name}\0${runtime.source}\0${runtime.version}`, runtime);
  }
  return [...byKey.values()];
}

/** Package ids keyed by `packageKey(ecosystem, name)`; missing packages are created. */
async function ensurePackages(
  db: PrismaClient,
  deps: readonly Pick<IngestDependency, "ecosystem" | "name">[]
) {
  const byEcosystem = new Map<string, Set<string>>();
  for (const dep of deps) {
    byEcosystem.set(dep.ecosystem, (byEcosystem.get(dep.ecosystem) ?? new Set()).add(dep.name));
  }
  const ids = new Map<string, string>();
  const CHUNK = 2000;
  for (const [ecosystem, names] of byEcosystem) {
    const unique = [...names];
    for (let i = 0; i < unique.length; i += CHUNK) {
      const slice = unique.slice(i, i + CHUNK);
      await db.package.createMany({
        data: slice.map((name) => ({ ecosystem, name })),
        skipDuplicates: true,
      });
      const rows = await db.package.findMany({
        where: { ecosystem, name: { in: slice } },
        select: { id: true, name: true },
      });
      for (const row of rows) ids.set(packageKey(ecosystem, row.name), row.id);
    }
  }
  return ids;
}

/**
 * Upserts each repo (new repos start excluded) and atomically replaces its
 * dependency rows, and its runtime rows when the upload carries runtimes.
 */
export async function ingestScan(
  db: PrismaClient,
  orgId: string,
  body: ScanBody,
  now: Date = new Date()
): Promise<RepoIngestResult[]> {
  const scoped = withOrg(db, orgId);
  const repos = body.repos.map((repo) => ({
    ...repo,
    dependencies: dedupeDependencies(repo.dependencies),
    runtimes: repo.runtimes ? dedupeRuntimes(repo.runtimes) : undefined,
  }));
  const packageIds = await ensurePackages(
    db,
    repos.flatMap((r) => r.dependencies)
  );

  const results: RepoIngestResult[] = [];
  for (const repo of repos) {
    const result = await scoped.$transaction(async (tx) => {
      const existing = await tx.repo.findUnique({
        where: { orgId_source_name: { orgId, source: body.source, name: repo.name } },
        select: { id: true },
      });
      const saved = existing
        ? await tx.repo.update({
            where: { id: existing.id },
            data: { path: repo.path ?? null, ecosystem: repo.ecosystem, lastScannedAt: now },
          })
        : await tx.repo.create({
            data: {
              orgId,
              name: repo.name,
              source: body.source,
              path: repo.path ?? null,
              ecosystem: repo.ecosystem,
              included: false,
              firstSeenAt: now,
              lastScannedAt: now,
            },
          });

      await tx.dependency.deleteMany({ where: { repoId: saved.id } });
      const rows = repo.dependencies.flatMap((dep) => {
        const packageId = packageIds.get(packageKey(dep.ecosystem, dep.name));
        return packageId
          ? [
              {
                orgId,
                repoId: saved.id,
                packageId,
                installedVersion: dep.version,
                direct: dep.direct,
                dev: dep.dev,
                manager: dep.manager,
                group: dep.group,
                requirement: dep.requirement,
                project: dep.project,
                constraint: dep.constraint,
                metadata: dep.metadata,
                unresolved: dep.unresolved,
              },
            ]
          : [];
      });
      if (rows.length > 0) await tx.dependency.createMany({ data: rows });

      let runtimesChanged = false;
      if (repo.runtimes) {
        const previous = await tx.repoRuntime.findMany({
          where: { repoId: saved.id },
          select: { name: true, version: true, normalized: true },
        });
        runtimesChanged = runtimesAdded(previous, repo.runtimes);
        await tx.repoRuntime.deleteMany({ where: { repoId: saved.id } });
        if (repo.runtimes.length > 0) {
          await tx.repoRuntime.createMany({
            data: repo.runtimes.map((r) => ({
              orgId,
              repoId: saved.id,
              name: r.name,
              version: r.version,
              normalized: r.normalized ?? null,
              source: r.source,
              unresolved: r.unresolved ?? false,
              image: r.image ?? null,
              constraint: isConstraintRow({ ...r, unresolved: r.unresolved ?? false }),
            })),
          });
        }
      }

      return {
        name: repo.name,
        created: !existing,
        dependencies: rows.length,
        direct: rows.filter((r) => r.direct).length,
        runtimes: repo.runtimes ? repo.runtimes.length : null,
        runtimesChanged,
      };
    });
    results.push(result);
  }
  return results;
}

export type ScannerOrgResolution =
  { ok: true; orgId: string } | { ok: false; reason: "no_org" | "ambiguous_org" | "unknown_org" };

/** The scanner token is instance-wide; it maps to SCANNER_ORG_ID or the only org. */
export async function resolveScannerOrg(
  db: PrismaClient,
  configuredOrgId: string | undefined
): Promise<ScannerOrgResolution> {
  if (configuredOrgId) {
    const org = await db.org.findUnique({ where: { id: configuredOrgId }, select: { id: true } });
    return org ? { ok: true, orgId: org.id } : { ok: false, reason: "unknown_org" };
  }
  const orgs = await db.org.findMany({
    select: { id: true },
    take: 2,
    orderBy: { createdAt: "asc" },
  });
  if (orgs.length === 0) return { ok: false, reason: "no_org" };
  if (orgs.length > 1) return { ok: false, reason: "ambiguous_org" };
  return { ok: true, orgId: orgs[0].id };
}
