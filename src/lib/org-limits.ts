import type { PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { isCloud } from "@/lib/env";
import { countMembers } from "@/lib/members";
import { limitsFor, PLANS, type OrgLimits, type OrgPlanRow } from "@/lib/plans";
import { freeSlug } from "@/lib/streams";

// Every limit check goes through loadOrgLimits -> limitsFor (src/lib/plans.ts). Over a limit
// nothing is deleted: new repos, streams or members are refused, existing ones stay.

export class OrgLimitError extends Error {}

/** A client or transaction: only the org row is read (Org is not a tenant model). */
interface OrgReader {
  org: {
    findUniqueOrThrow(args: {
      where: { id: string };
      select: { plan: true; repoLimit: true; streamLimit: true };
    }): PromiseLike<OrgPlanRow>;
  };
}

/** The org's limits; pass the transaction that holds the org's advisory lock when checking. */
export async function loadOrgLimits(db: OrgReader, orgId: string): Promise<OrgLimits> {
  const org = await db.org.findUniqueOrThrow({
    where: { id: orgId },
    select: { plan: true, repoLimit: true, streamLimit: true },
  });
  return limitsFor(org, { cloud: isCloud() });
}

function limitMessage(kind: string, limit: number | null, limits: OrgLimits): string {
  const plan = PLANS[limits.plan].name;
  return `${kind} limit reached (${limit ?? "none"} on the ${plan} plan). See Settings → Billing for the plans.`;
}

export function memberLimitMessage(limits: OrgLimits): string {
  return limitMessage("Member", limits.memberLimit, limits);
}

export function repoLimitMessage(limits: OrgLimits): string {
  return limitMessage("Repository", limits.repoLimit, limits);
}

export async function createLimitedStream(
  db: PrismaClient,
  orgId: string,
  name: string
): Promise<void> {
  await withOrg(db, orgId).$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(68422::int, hashtext(${orgId}))`;
    const limits = await loadOrgLimits(tx, orgId);
    if (limits.streamLimit !== null && (await tx.bulletinStream.count()) >= limits.streamLimit)
      throw new OrgLimitError(limitMessage("Stream", limits.streamLimit, limits));
    await tx.bulletinStream.create({ data: { orgId, name, slug: await freeSlug(tx, name) } });
  });
}

/**
 * Throws OrgLimitError when the org has no seat left for one more member or invite (seats:
 * `countMembers`, members plus pending invites). Returns the limits, so the caller can pass
 * `memberLimit` to the invite write, which checks again under the membership lock.
 */
export async function assertMemberCapacity(
  orgId: string,
  db: PrismaClient = getDb()
): Promise<OrgLimits> {
  const limits = await loadOrgLimits(db, orgId);
  if (limits.memberLimit !== null && (await countMembers(db, orgId)) >= limits.memberLimit)
    throw new OrgLimitError(memberLimitMessage(limits));
  return limits;
}
