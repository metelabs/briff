import "server-only";

import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { ensureDefaultStream } from "@/lib/streams";

type OrgArgs = { name: string; userId: string };

/**
 * Creates an org owned by `userId` with an empty profile and the default stream,
 * in one transaction. The id is chosen up front so the stream (a tenant row) is
 * written through withOrg rather than a nested relation write. With `below`, the org is
 * created only while the user has fewer memberships than that, checked under a per-user
 * lock so parallel requests cannot pass the check together; null otherwise.
 */
async function writeOrg(
  db: PrismaClient,
  args: OrgArgs,
  below: number | null
): Promise<string | null> {
  const orgId = randomUUID();
  return withOrg(db, orgId).$transaction(async (tx) => {
    if (below !== null) {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`user-orgs:${args.userId}`}))`;
      // The user's own memberships across orgs, like getOrgContext.
      const user = await tx.user.findUnique({
        where: { id: args.userId },
        select: { _count: { select: { memberships: true } } },
      });
      if (!user || user._count.memberships >= below) return null;
    }
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
    return orgId;
  });
}

export async function createOrgForUser(db: PrismaClient, args: OrgArgs): Promise<string> {
  const orgId = await writeOrg(db, args, null);
  if (!orgId) throw new Error("org not created");
  return orgId;
}

/** A first org for a user who belongs to none (`ensureUserHasOrg`); null when they do. */
export function createOrgIfNone(db: PrismaClient, args: OrgArgs): Promise<string | null> {
  return writeOrg(db, args, 1);
}

/** "Create organisation": null when the user already belongs to `max` orgs. */
export function createOrgWithin(
  db: PrismaClient,
  args: OrgArgs,
  max: number
): Promise<string | null> {
  return writeOrg(db, args, max);
}
