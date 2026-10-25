import "server-only";

import { getOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { getEnv } from "@/lib/env";
import { verifyFeedbackToken } from "@/lib/feedback-token";

export interface BulletinAccess {
  orgId: string;
  userId: string;
  via: "session" | "token";
}

/**
 * Who may see a bulletin and give feedback on it: a signed-in member of its org,
 * or the recipient of its email (signed token), and only if that user still
 * belongs to the bulletin's org.
 */
export async function resolveBulletinAccess(
  bulletinId: string,
  token: string | null
): Promise<BulletinAccess | null> {
  const ctx = await getOrgContext();
  const db = getDb();
  if (ctx) {
    const found = await withOrg(db, ctx.orgId).bulletin.count({ where: { id: bulletinId } });
    if (found > 0) return { orgId: ctx.orgId, userId: ctx.userId, via: "session" };
  }
  if (!token) return null;
  const userId = verifyFeedbackToken(getEnv().BETTER_AUTH_SECRET, bulletinId, token);
  if (!userId) return null;
  // Membership lookup is keyed by user, before any org is known (same as session.ts).
  const memberships = await db.orgMember.findMany({ where: { userId }, select: { orgId: true } });
  for (const { orgId } of memberships) {
    const found = await withOrg(db, orgId).bulletin.count({ where: { id: bulletinId } });
    if (found > 0) return { orgId, userId, via: "token" };
  }
  return null;
}

/** True when the item is part of this bulletin (feedback is only taken on what was shown). */
export async function bulletinHasItem(
  orgId: string,
  bulletinId: string,
  itemId: string
): Promise<boolean> {
  const count = await withOrg(getDb(), orgId).bulletinItem.count({ where: { bulletinId, itemId } });
  return count > 0;
}
