import "server-only";

import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { ensureDefaultStream } from "@/lib/streams";

/**
 * Creates an org owned by `userId` with an empty profile and the default stream,
 * in one transaction. The id is chosen up front so the stream (a tenant row) is
 * written through withOrg rather than a nested relation write.
 */
export async function createOrgForUser(
  db: PrismaClient,
  args: { name: string; userId: string }
): Promise<string> {
  const orgId = randomUUID();
  await withOrg(db, orgId).$transaction(async (tx) => {
    await tx.org.create({
      data: {
        id: orgId,
        name: args.name,
      },
    });
    await tx.orgMember.create({ data: { orgId, userId: args.userId, role: "owner" } });
    await tx.interestProfile.create({ data: { orgId } });
    await tx.orgEvent.create({
      data: { orgId, actorUserId: args.userId, type: "org_created", detail: args.name },
    });
    await ensureDefaultStream(tx, orgId);
  });
  return orgId;
}
