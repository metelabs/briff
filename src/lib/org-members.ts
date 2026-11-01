import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";

/** Seats an org uses against its member limit (src/lib/plans.ts): its OrgMember rows. */
export async function countMembers(orgId: string, db: PrismaClient = getDb()): Promise<number> {
  return withOrg(db, orgId).orgMember.count();
}
