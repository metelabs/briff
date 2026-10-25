import "server-only";

import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { repoScope, type StreamScope } from "@/lib/stream-scope";
import { computeDrift, type DriftColumn, type DriftRow } from "@/pipeline/stack-drift";

/** The scope's repos with their drift (Stack page, home overview). */
export async function loadDrift(
  orgId: string,
  scope: Pick<StreamScope, "current">
): Promise<{
  repos: { id: string; name: string }[];
  drift: { columns: DriftColumn[]; rows: DriftRow[] };
}> {
  const db = withOrg(getDb(), orgId);
  const repos = await db.repo.findMany({
    where: repoScope(scope),
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const repoIds = repos.map((r) => r.id);
  const [runtimes, deps] = await Promise.all([
    db.repoRuntime.findMany({
      where: { repoId: { in: repoIds } },
      select: {
        repoId: true,
        name: true,
        version: true,
        normalized: true,
        source: true,
        unresolved: true,
        image: true,
        constraint: true,
      },
    }),
    db.dependency.findMany({
      where: { repoId: { in: repoIds }, direct: true },
      select: {
        repoId: true,
        installedVersion: true,
        unresolved: true,
        package: { select: { ecosystem: true, name: true, latestVersion: true } },
      },
    }),
  ]);
  const nameOf = new Map(repos.map((r) => [r.id, r.name]));
  const drift = computeDrift({
    asOf: new Date(),
    repos: repos.map((r) => r.name),
    runtimes: runtimes.map((r) => ({ ...r, repo: nameOf.get(r.repoId) ?? r.repoId })),
    dependencies: deps.map((d) => ({
      repo: nameOf.get(d.repoId) ?? d.repoId,
      ecosystem: d.package.ecosystem,
      packageName: d.package.name,
      installedVersion: d.installedVersion,
      unresolved: d.unresolved,
      latestVersion: d.package.latestVersion,
    })),
  });
  return { repos, drift };
}
