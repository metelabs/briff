import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { imageDistro } from "@scan/distros";

import { severityRank } from "./plan";

/** A base image alert means a fix for the release was published this recently. */
export const FIX_WINDOW_DAYS = 14;
export const FIX_WINDOW_MS = FIX_WINDOW_DAYS * 86_400_000;

export function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** One watched image in one repo and the fixes published for its distro release. */
export interface BaseImageGroup {
  image: string;
  repo: string;
  action: string;
  advisories: {
    osvId: string;
    summary: string | null;
    severity: string | null;
    packages: string[];
  }[];
}

/**
 * Grouped base image alerts of the repos in `repoWhere`: created in `period` (bulletins), or
 * within the fix window (the Alerts page) when no period is given.
 */
export async function loadBaseImageGroups(
  db: PrismaClient,
  orgId: string,
  repoWhere: Prisma.RepoWhereInput,
  period?: { gte: Date; lt: Date },
  now: Date = new Date()
): Promise<BaseImageGroup[]> {
  const org = await db.org.findUnique({ where: { id: orgId }, select: { baseImageAlerts: true } });
  if (!org?.baseImageAlerts) return [];
  const rows = await withOrg(db, orgId).baseImageAlert.findMany({
    where: {
      active: true,
      repo: repoWhere,
      createdAt: period ?? { gte: new Date(now.getTime() - FIX_WINDOW_MS) },
    },
    include: { repo: { select: { name: true, runtimes: { select: { image: true } } } } },
  });
  const grouped = new Map<string, BaseImageGroup>();
  for (const row of rows) {
    if (!row.repo.runtimes.some((r) => r.image === row.image)) continue;
    const key = `${row.repo.name}\0${row.image}`;
    const group = grouped.get(key) ?? {
      image: row.image,
      repo: row.repo.name,
      action: row.action,
      advisories: [],
    };
    if (!group.advisories.some((a) => a.osvId === row.osvId))
      group.advisories.push({
        osvId: row.osvId,
        summary: row.summary,
        severity: row.severity,
        packages: stringArray(row.packages),
      });
    grouped.set(key, group);
  }
  return [...grouped.values()]
    .map((g) => ({
      ...g,
      advisories: g.advisories.sort(
        (a, b) =>
          severityRank(b.severity) - severityRank(a.severity) || a.osvId.localeCompare(b.osvId)
      ),
    }))
    .sort((a, b) => a.repo.localeCompare(b.repo) || a.image.localeCompare(b.image));
}

export interface UnfixedDistro {
  /** `debian 12`. */
  distro: string;
  unfixed: number;
}

/** Open issues per distro release the repos run: a count only, nothing to rebuild for. */
export async function loadUnfixedDistros(
  db: PrismaClient,
  orgId: string,
  repoWhere: Prisma.RepoWhereInput
): Promise<UnfixedDistro[]> {
  const org = await db.org.findUnique({ where: { id: orgId }, select: { baseImageAlerts: true } });
  if (!org?.baseImageAlerts) return [];
  const runtimes = await withOrg(db, orgId).repoRuntime.findMany({
    where: { name: { in: ["debian", "ubuntu", "alpine"] }, image: { not: null }, repo: repoWhere },
    select: { image: true },
  });
  const labels = new Map<string, string>();
  for (const { image } of runtimes) {
    const distro = image ? imageDistro(image) : null;
    if (distro) labels.set(distro.ecosystem, `${distro.name} ${distro.version}`);
  }
  if (!labels.size) return [];
  // BaseImageDistro is a global catalog table (public OSV counts, no tenant data).
  const rows = await db.baseImageDistro.findMany({
    where: { ecosystem: { in: [...labels.keys()] }, unfixed: { gt: 0 } },
    select: { ecosystem: true, unfixed: true },
  });
  return rows
    .map((r) => ({ distro: labels.get(r.ecosystem) ?? r.ecosystem, unfixed: r.unfixed }))
    .sort((a, b) => a.distro.localeCompare(b.distro));
}
