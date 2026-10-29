import type { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";

export interface OrgCapacity {
  repos: number;
  repoLimit: number;
  streams: number;
  streamLimit: number;
}

export async function loadOrgCapacity(db: PrismaClient, orgId: string): Promise<OrgCapacity> {
  const scoped = withOrg(db, orgId);
  const [org, repos, streams] = await Promise.all([
    db.org.findUniqueOrThrow({
      where: { id: orgId },
      select: { repoLimit: true, streamLimit: true },
    }),
    scoped.repo.count(),
    scoped.bulletinStream.count(),
  ]);
  return { ...org, repos, streams };
}
