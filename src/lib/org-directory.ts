import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { limitsFor } from "@/lib/plans";

import type { OrgRow } from "./org-directory-view";

/**
 * Every organisation of the instance with its owner, members, repos and streams, for the
 * instance admin's table (`/admin`, behind requireAdminContext). The one tenant read outside
 * withOrg that spans orgs on purpose: counts and the owner's email only, a fixed number of
 * grouped queries however many orgs there are, never rendered for anyone but the admin.
 */
export async function loadOrgDirectory(
  db: PrismaClient,
  { cloud }: { cloud: boolean }
): Promise<OrgRow[]> {
  const [orgs, repos, streams, members, owners] = await Promise.all([
    db.org.findMany({
      select: {
        id: true,
        name: true,
        createdAt: true,
        plan: true,
        repoLimit: true,
        streamLimit: true,
      },
    }),
    db.repo.groupBy({ by: ["orgId"], _count: { _all: true } }),
    db.bulletinStream.groupBy({ by: ["orgId"], _count: { _all: true } }),
    db.orgMember.groupBy({ by: ["orgId"], _count: { _all: true } }),
    db.orgMember.findMany({
      where: { role: "owner" },
      orderBy: { createdAt: "asc" },
      select: { orgId: true, user: { select: { email: true } } },
    }),
  ]);
  const count = (rows: { orgId: string; _count: { _all: number } }[]) =>
    new Map(rows.map((r) => [r.orgId, r._count._all]));
  const repoCount = count(repos);
  const streamCount = count(streams);
  const memberCount = count(members);
  const ownerEmail = new Map<string, string>();
  for (const o of owners) if (!ownerEmail.has(o.orgId)) ownerEmail.set(o.orgId, o.user.email);
  return orgs.map((o) => {
    const limits = limitsFor(o, { cloud });
    return {
      id: o.id,
      name: o.name,
      createdAt: o.createdAt,
      plan: o.plan,
      repoOverride: o.repoLimit,
      streamOverride: o.streamLimit,
      repoLimit: limits.repoLimit,
      streamLimit: limits.streamLimit,
      ownerEmail: ownerEmail.get(o.id) ?? null,
      members: memberCount.get(o.id) ?? 0,
      repos: repoCount.get(o.id) ?? 0,
      streams: streamCount.get(o.id) ?? 0,
    };
  });
}
