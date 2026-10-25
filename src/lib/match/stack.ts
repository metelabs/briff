import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { serviceByKey, serviceForPackage } from "@/lib/services";

import {
  runtimesOf,
  stackPackageKey,
  type OrgStack,
  type StackPackage,
  type StackService,
} from "./matcher";

/** Builds each org's stack (or the given orgs') from all scanned repos (inclusion is applied at bulletin time). */
export async function loadOrgStacks(db: PrismaClient, orgIds?: string[]): Promise<OrgStack[]> {
  const orgs = await db.org.findMany({
    where: orgIds ? { id: { in: orgIds } } : undefined,
    select: { id: true },
  });
  const stacks: OrgStack[] = [];

  for (const org of orgs) {
    const scoped = withOrg(db, org.id);
    const runtimeRows = await scoped.repoRuntime.findMany({
      select: { repoId: true, name: true, version: true, normalized: true },
    });
    const deps = await scoped.dependency.findMany({
      select: {
        repoId: true,
        direct: true,
        package: {
          select: {
            id: true,
            ecosystem: true,
            name: true,
            releaseFeedUrl: true,
            service: { select: { key: true } },
          },
        },
      },
    });

    const packages = new Map<string, StackPackage>();
    const packagesByFeed = new Map<string, string[]>();
    const services = new Map<string, StackService>();
    const traits = new Set<string>();

    for (const dep of deps) {
      const { package: pkg } = dep;
      const serviceKey = pkg.service?.key ?? serviceForPackage(pkg.name)?.key ?? null;
      const key = stackPackageKey(pkg.ecosystem, pkg.name);
      const existing = packages.get(key);
      if (existing) {
        existing.direct ||= dep.direct;
        existing.repoIds.add(dep.repoId);
      } else {
        packages.set(key, {
          packageId: pkg.id,
          ecosystem: pkg.ecosystem,
          name: pkg.name,
          direct: dep.direct,
          repoIds: new Set([dep.repoId]),
          serviceKey,
        });
        if (pkg.releaseFeedUrl) {
          packagesByFeed.set(pkg.releaseFeedUrl, [
            ...(packagesByFeed.get(pkg.releaseFeedUrl) ?? []),
            key,
          ]);
        }
      }
      // Services and traits only follow direct usage; a transitive Sentry
      // dependency does not make the org a Sentry customer.
      if (serviceKey && dep.direct) {
        const definition = serviceByKey(serviceKey);
        const service = services.get(serviceKey) ?? {
          key: serviceKey,
          name: definition?.name ?? serviceKey,
          repoIds: new Set<string>(),
        };
        service.repoIds.add(dep.repoId);
        services.set(serviceKey, service);
        for (const trait of definition?.traits ?? []) traits.add(trait);
      }
    }

    stacks.push({
      orgId: org.id,
      packages,
      packagesByFeed,
      services,
      runtimes: runtimesOf(runtimeRows),
      traits,
    });
  }
  return stacks;
}
