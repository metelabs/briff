import type { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { isCloud } from "@/lib/env";
import { countMembers } from "@/lib/org-members";
import { loadOrgLimits } from "@/lib/org-limits";
import type { OrgLimits } from "@/lib/plans";

export interface OrgCapacity extends OrgLimits {
  /** False on a self-hosted instance: no plans, no limits, nothing to show. */
  cloud: boolean;
  repos: number;
  streams: number;
  members: number;
}

export async function loadOrgCapacity(db: PrismaClient, orgId: string): Promise<OrgCapacity> {
  const scoped = withOrg(db, orgId);
  const [limits, repos, streams, members] = await Promise.all([
    loadOrgLimits(db, orgId),
    scoped.repo.count(),
    scoped.bulletinStream.count(),
    countMembers(orgId, db),
  ]);
  return { ...limits, cloud: isCloud(), repos, streams, members };
}
