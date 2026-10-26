import { mapLimit } from "@/lib/concurrency";
import { serviceForPackage } from "@/lib/services";
import type { JobContext, JobResult } from "@/worker/types";
import { ECOSYSTEMS, isEcosystem } from "@scan/ecosystems";

import { syncServices } from "./catalog";
import { githubReleasesFeedUrl, githubRepoUrl, parseGithubRepo } from "./github-releases";
import { fetchRegistryPackage } from "./registries";

const CONCURRENCY = 12;
const BATCH_LIMIT = 2500;
const STALE_AFTER_MS = 20 * 60 * 60_000;

/**
 * refresh-packages (plan §7.1): latest version, deprecation and GitHub repo for
 * direct dependencies from their ecosystem's registry (npm, Packagist; registries.ts);
 * service links for every package; one GitHub Releases source per repo that a direct
 * dependency publishes from.
 */
export async function refreshPackages({ db, log, heartbeat }: JobContext): Promise<JobResult> {
  const serviceIds = await syncServices(db);
  const counts = {
    refreshed: 0,
    notFound: 0,
    errors: 0,
    deprecated: 0,
    servicesLinked: 0,
    releaseSources: 0,
  };

  // Service links are a pure name mapping: cheap enough for every package.
  const all = await db.package.findMany({ select: { id: true, name: true, serviceId: true } });
  const byService = new Map<string, string[]>();
  for (const pkg of all) {
    const key = serviceForPackage(pkg.name)?.key;
    const serviceId = key ? serviceIds.get(key) : undefined;
    if (serviceId && pkg.serviceId !== serviceId) {
      byService.set(serviceId, [...(byService.get(serviceId) ?? []), pkg.id]);
    }
  }
  for (const [serviceId, ids] of byService) {
    const res = await db.package.updateMany({ where: { id: { in: ids } }, data: { serviceId } });
    counts.servicesLinked += res.count;
  }

  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  const stale = await db.package.findMany({
    where: {
      ecosystem: { in: [...ECOSYSTEMS] },
      dependencies: { some: { direct: true } },
      OR: [{ lastRefreshedAt: null }, { lastRefreshedAt: { lt: cutoff } }],
    },
    select: { id: true, name: true, ecosystem: true },
    orderBy: { lastRefreshedAt: { sort: "asc", nulls: "first" } },
    take: BATCH_LIMIT,
  });

  let processed = 0;
  await mapLimit(stale, CONCURRENCY, async (pkg) => {
    if (++processed % 50 === 0) await heartbeat();
    try {
      if (!isEcosystem(pkg.ecosystem)) return;
      const lookup = await fetchRegistryPackage(pkg.ecosystem, pkg.name);
      if (lookup.status === "not_found") {
        counts.notFound++;
        await db.package.update({ where: { id: pkg.id }, data: { lastRefreshedAt: new Date() } });
        return;
      }
      const { info } = lookup;
      const repo = parseGithubRepo(info.repositoryUrl);
      if (info.deprecated) counts.deprecated++;
      await db.package.update({
        where: { id: pkg.id },
        data: {
          actionTags: info.actionTags,
          latestVersion: info.latestVersion,
          deprecated: info.deprecated,
          repoUrl: repo ? githubRepoUrl(repo) : info.repositoryUrl,
          releaseFeedUrl: repo ? githubReleasesFeedUrl(repo) : null,
          lastRefreshedAt: new Date(),
        },
      });
      counts.refreshed++;
    } catch (err) {
      counts.errors++;
      log.warn(
        { err, ecosystem: pkg.ecosystem, name: pkg.name },
        "refresh: registry lookup failed"
      );
    }
  });

  if (stale.length > 0 && counts.errors === stale.length) {
    throw new Error(`all ${stale.length} registry lookups failed`);
  }

  const withFeeds = await db.package.findMany({
    where: { releaseFeedUrl: { not: null }, dependencies: { some: { direct: true } } },
    select: { id: true, releaseFeedUrl: true, repoUrl: true, serviceId: true },
    orderBy: { name: "asc" },
  });
  const feeds = new Map<string, (typeof withFeeds)[number]>();
  for (const pkg of withFeeds)
    if (pkg.releaseFeedUrl && !feeds.has(pkg.releaseFeedUrl)) feeds.set(pkg.releaseFeedUrl, pkg);
  const created = await db.source.createMany({
    data: [...feeds.entries()].map(([url, pkg]) => ({
      kind: "github_releases" as const,
      url,
      name: `${(pkg.repoUrl ?? url).replace("https://github.com/", "")} releases`,
      packageId: pkg.id,
      serviceId: pkg.serviceId,
    })),
    skipDuplicates: true,
  });
  counts.releaseSources = created.count;

  log.info(counts, "refresh: done");
  return { counts };
}
