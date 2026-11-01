import "server-only";

import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { repoScope, type StreamScope } from "@/lib/stream-scope";
import { computeDrift, type StackRepo } from "@/pipeline/stack-drift";

import { connectionLabel } from "./repos";

export interface StackCard extends StackRepo {
  id: string;
  /** `GitHub App`, `GitHub`, `Local scanner`. */
  connection: string;
  lastScannedAt: Date | null;
}

/** The scope's repos with their drift, most urgent first (Stack page, home overview). */
export async function loadDrift(
  orgId: string,
  scope: Pick<StreamScope, "current">
): Promise<{ repos: { id: string; name: string }[]; drift: StackCard[] }> {
  const db = withOrg(getDb(), orgId);
  const repos = await db.repo.findMany({
    where: repoScope(scope),
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      source: true,
      githubInstallationId: true,
      lastScannedAt: true,
    },
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
  const byId = new Map(repos.map((r) => [r.id, r]));
  const stack = computeDrift({
    asOf: new Date(),
    repos: repos.map((r) => ({ key: r.id, name: r.name })),
    runtimes: runtimes.map((r) => ({ ...r, repo: r.repoId })),
    dependencies: deps.map((d) => ({
      repo: d.repoId,
      ecosystem: d.package.ecosystem,
      packageName: d.package.name,
      installedVersion: d.installedVersion,
      unresolved: d.unresolved,
      latestVersion: d.package.latestVersion,
    })),
  });
  const drift = stack.flatMap((card) => {
    const repo = byId.get(card.key);
    return repo
      ? [
          {
            ...card,
            id: repo.id,
            connection: connectionLabel(repo),
            lastScannedAt: repo.lastScannedAt,
          },
        ]
      : [];
  });
  return { repos, drift };
}
