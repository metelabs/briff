import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";

import { severityRank } from "./plan";

export interface BaseImageGroup {
  image: string;
  action: string;
  repos: string[];
  advisories: { osvId: string; summary: string | null; severity: string | null }[];
}

export async function loadBaseImageGroups(
  db: PrismaClient,
  orgId: string,
  repoWhere: Prisma.RepoWhereInput,
  period?: { gte: Date; lt: Date }
): Promise<BaseImageGroup[]> {
  const org = await db.org.findUnique({ where: { id: orgId }, select: { baseImageAlerts: true } });
  if (!org?.baseImageAlerts) return [];
  const rows = await withOrg(db, orgId).baseImageAlert.findMany({
    where: { active: true, repo: repoWhere, ...(period ? { createdAt: period } : {}) },
    include: { repo: { select: { name: true, runtimes: { select: { image: true } } } } },
  });
  const grouped = new Map<string, BaseImageGroup>();
  for (const row of rows) {
    if (!row.repo.runtimes.some((r) => r.image === row.image)) continue;
    const group = grouped.get(row.image) ?? {
      image: row.image,
      action: row.action,
      repos: [],
      advisories: [],
    };
    if (!group.repos.includes(row.repo.name)) group.repos.push(row.repo.name);
    if (!group.advisories.some((a) => a.osvId === row.osvId))
      group.advisories.push({ osvId: row.osvId, summary: row.summary, severity: row.severity });
    grouped.set(row.image, group);
  }
  return [...grouped.values()]
    .map((g) => ({
      ...g,
      repos: g.repos.sort(),
      advisories: g.advisories.sort(
        (a, b) =>
          severityRank(b.severity) - severityRank(a.severity) || a.osvId.localeCompare(b.osvId)
      ),
    }))
    .sort((a, b) => a.image.localeCompare(b.image));
}
