import "server-only";

import type { OrgEventType, OrgRole, PrismaClient } from "@/generated/prisma/client";
import { type OrgDb, withOrg } from "@/lib/db/with-org";
import {
  generateInviteToken,
  hashInviteToken,
  INVITE_TTL_MS,
  inviteStatus,
  type InviteStatus,
  isInviteToken,
  normalizeEmail,
} from "@/lib/invite-token";
import { createOrgForUser } from "@/lib/org";

// Org membership: invites, roles, removal and the audit log (Settings -> Members). Owners
// invite, change roles, remove members and rename the org; the last owner can never be
// removed or demoted. Every write runs in one transaction holding a per-org advisory lock,
// so two owners demoting each other at once cannot leave the org without an owner.

export const INVITES_PER_DAY = 20;
export const ORG_NAME_MAX = 100;
export const EVENTS_SHOWN = 50;
/** Orgs one account may belong to; "Create organisation" stops there. */
export const MAX_ORGS_PER_USER = 20;

type MembersTx = Pick<OrgDb, "orgMember" | "orgInvite" | "orgEvent" | "$queryRaw">;

async function lockMembers(tx: MembersTx, orgId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`org-members:${orgId}`}))`;
}

async function isOwner(tx: MembersTx, userId: string): Promise<boolean> {
  const row = await tx.orgMember.findFirst({ where: { userId }, select: { role: true } });
  return row?.role === "owner";
}

async function recordEvent(
  tx: MembersTx,
  orgId: string,
  event: {
    type: OrgEventType;
    actorUserId: string | null;
    targetEmail?: string | null;
    targetUserId?: string | null;
    detail?: string | null;
  }
): Promise<void> {
  await tx.orgEvent.create({ data: { orgId, ...event } });
}

function pendingWhere(now: Date) {
  return { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } };
}

/**
 * Seats in use: members plus pending (unexpired, unrevoked, unaccepted) invites. The one
 * place that counts them, so a member limit has a single number to compare against.
 */
export async function countMembers(
  db: PrismaClient,
  orgId: string,
  now = new Date()
): Promise<number> {
  const scoped = withOrg(db, orgId);
  const [members, invites] = await Promise.all([
    scoped.orgMember.count(),
    scoped.orgInvite.count({ where: pendingWhere(now) }),
  ]);
  return members + invites;
}

export async function memberRole(
  db: PrismaClient,
  orgId: string,
  userId: string
): Promise<OrgRole | null> {
  const row = await withOrg(db, orgId).orgMember.findFirst({
    where: { userId },
    select: { role: true },
  });
  return row?.role ?? null;
}

export type CreateInviteResult =
  | { ok: true; inviteId: string; token: string; email: string; expiresAt: Date }
  | { ok: false; reason: "not-owner" | "already-member" | "already-invited" | "rate-limited" };

async function underDailyLimit(tx: MembersTx, now: Date): Promise<boolean> {
  const sent = await tx.orgEvent.count({
    where: { type: "member_invited", createdAt: { gt: new Date(now.getTime() - 86_400_000) } },
  });
  return sent < INVITES_PER_DAY;
}

/** Creates a pending invite; the caller emails the returned token (never stored). */
export async function createInvite(
  db: PrismaClient,
  args: { orgId: string; actorUserId: string; email: string; role: OrgRole; now?: Date }
): Promise<CreateInviteResult> {
  const now = args.now ?? new Date();
  const email = normalizeEmail(args.email);
  return withOrg(db, args.orgId).$transaction(async (tx): Promise<CreateInviteResult> => {
    await lockMembers(tx, args.orgId);
    if (!(await isOwner(tx, args.actorUserId))) return { ok: false, reason: "not-owner" };
    if ((await tx.orgMember.count({ where: { user: { email } } })) > 0) {
      return { ok: false, reason: "already-member" };
    }
    if ((await tx.orgInvite.count({ where: { email, ...pendingWhere(now) } })) > 0) {
      return { ok: false, reason: "already-invited" };
    }
    if (!(await underDailyLimit(tx, now))) return { ok: false, reason: "rate-limited" };
    const { token, tokenHash } = generateInviteToken();
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
    const invite = await tx.orgInvite.create({
      data: {
        orgId: args.orgId,
        email,
        role: args.role,
        tokenHash,
        invitedByUserId: args.actorUserId,
        createdAt: now,
        sentAt: now,
        expiresAt,
      },
      select: { id: true },
    });
    await recordEvent(tx, args.orgId, {
      type: "member_invited",
      actorUserId: args.actorUserId,
      targetEmail: email,
      detail: args.role,
    });
    return { ok: true, inviteId: invite.id, token, email, expiresAt };
  });
}

export type ResendInviteResult =
  | { ok: true; token: string; email: string; role: OrgRole; expiresAt: Date }
  | { ok: false; reason: "not-owner" | "not-found" | "already-member" | "rate-limited" };

/**
 * A new link for a pending or expired invite: the old link stops working, the 7 days start
 * again. Counts against the daily invite limit like a new invite.
 */
export async function resendInvite(
  db: PrismaClient,
  args: { orgId: string; actorUserId: string; inviteId: string; now?: Date }
): Promise<ResendInviteResult> {
  const now = args.now ?? new Date();
  return withOrg(db, args.orgId).$transaction(async (tx): Promise<ResendInviteResult> => {
    await lockMembers(tx, args.orgId);
    if (!(await isOwner(tx, args.actorUserId))) return { ok: false, reason: "not-owner" };
    const invite = await tx.orgInvite.findFirst({
      where: { id: args.inviteId, acceptedAt: null, revokedAt: null },
      select: { id: true, email: true, role: true },
    });
    if (!invite) return { ok: false, reason: "not-found" };
    if ((await tx.orgMember.count({ where: { user: { email: invite.email } } })) > 0) {
      return { ok: false, reason: "already-member" };
    }
    if (!(await underDailyLimit(tx, now))) return { ok: false, reason: "rate-limited" };
    const { token, tokenHash } = generateInviteToken();
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
    await tx.orgInvite.update({
      where: { id: invite.id },
      data: { tokenHash, sentAt: now, expiresAt },
    });
    await recordEvent(tx, args.orgId, {
      type: "member_invited",
      actorUserId: args.actorUserId,
      targetEmail: invite.email,
      detail: "resent",
    });
    return { ok: true, token, email: invite.email, role: invite.role, expiresAt };
  });
}

export type SimpleResult<R extends string> = { ok: true } | { ok: false; reason: R };

export async function revokeInvite(
  db: PrismaClient,
  args: { orgId: string; actorUserId: string; inviteId: string; now?: Date }
): Promise<SimpleResult<"not-owner" | "not-found">> {
  const now = args.now ?? new Date();
  return withOrg(db, args.orgId).$transaction(
    async (tx): Promise<SimpleResult<"not-owner" | "not-found">> => {
      await lockMembers(tx, args.orgId);
      if (!(await isOwner(tx, args.actorUserId))) return { ok: false, reason: "not-owner" };
      const invite = await tx.orgInvite.findFirst({
        where: { id: args.inviteId, acceptedAt: null, revokedAt: null },
        select: { id: true, email: true },
      });
      if (!invite) return { ok: false, reason: "not-found" };
      await tx.orgInvite.update({ where: { id: invite.id }, data: { revokedAt: now } });
      await recordEvent(tx, args.orgId, {
        type: "invite_revoked",
        actorUserId: args.actorUserId,
        targetEmail: invite.email,
      });
      return { ok: true };
    }
  );
}

type MemberChangeReason = "not-owner" | "not-found" | "last-owner" | "self";

async function ownerCount(tx: MembersTx): Promise<number> {
  return tx.orgMember.count({ where: { role: "owner" } });
}

export async function changeMemberRole(
  db: PrismaClient,
  args: { orgId: string; actorUserId: string; memberUserId: string; role: OrgRole }
): Promise<SimpleResult<MemberChangeReason | "unchanged">> {
  return withOrg(db, args.orgId).$transaction(
    async (tx): Promise<SimpleResult<MemberChangeReason | "unchanged">> => {
      await lockMembers(tx, args.orgId);
      if (!(await isOwner(tx, args.actorUserId))) return { ok: false, reason: "not-owner" };
      const member = await tx.orgMember.findFirst({
        where: { userId: args.memberUserId },
        select: { id: true, role: true, user: { select: { email: true } } },
      });
      if (!member) return { ok: false, reason: "not-found" };
      if (member.role === args.role) return { ok: false, reason: "unchanged" };
      if (member.role === "owner" && (await ownerCount(tx)) <= 1) {
        return { ok: false, reason: "last-owner" };
      }
      await tx.orgMember.update({ where: { id: member.id }, data: { role: args.role } });
      await recordEvent(tx, args.orgId, {
        type: "role_changed",
        actorUserId: args.actorUserId,
        targetUserId: args.memberUserId,
        targetEmail: member.user.email,
        detail: args.role,
      });
      return { ok: true };
    }
  );
}

/**
 * Takes a member out of the org (an owner removing someone, or the member leaving). A user
 * left without any org gets a fresh one of their own, as at sign-up, so every account
 * still has somewhere to land.
 */
async function dropMember(
  db: PrismaClient,
  args: { orgId: string; actorUserId: string; memberUserId: string; leaving: boolean }
): Promise<SimpleResult<MemberChangeReason>> {
  const result = await withOrg(db, args.orgId).$transaction(
    async (tx): Promise<SimpleResult<MemberChangeReason>> => {
      await lockMembers(tx, args.orgId);
      if (!args.leaving) {
        if (args.memberUserId === args.actorUserId) return { ok: false, reason: "self" };
        if (!(await isOwner(tx, args.actorUserId))) return { ok: false, reason: "not-owner" };
      }
      const member = await tx.orgMember.findFirst({
        where: { userId: args.memberUserId },
        select: { id: true, role: true, user: { select: { email: true } } },
      });
      if (!member) return { ok: false, reason: "not-found" };
      if (member.role === "owner" && (await ownerCount(tx)) <= 1) {
        return { ok: false, reason: "last-owner" };
      }
      await tx.orgMember.deleteMany({ where: { id: member.id } });
      await recordEvent(tx, args.orgId, {
        type: "member_removed",
        actorUserId: args.actorUserId,
        targetUserId: args.memberUserId,
        targetEmail: member.user.email,
        detail: args.leaving ? "left" : null,
      });
      return { ok: true };
    }
  );
  if (result.ok) await ensureUserHasOrg(db, args.memberUserId);
  return result;
}

export function removeMember(
  db: PrismaClient,
  args: { orgId: string; actorUserId: string; memberUserId: string }
): Promise<SimpleResult<MemberChangeReason>> {
  return dropMember(db, { ...args, leaving: false });
}

export function leaveOrg(
  db: PrismaClient,
  args: { orgId: string; userId: string }
): Promise<SimpleResult<MemberChangeReason>> {
  return dropMember(db, {
    orgId: args.orgId,
    actorUserId: args.userId,
    memberUserId: args.userId,
    leaving: true,
  });
}

/**
 * Gives a user who belongs to no org (removed, left, or their last org was deleted by
 * another owner) a new org of their own. Reads the user's own memberships across orgs,
 * like `getOrgContext`.
 */
export async function ensureUserHasOrg(db: PrismaClient, userId: string): Promise<string | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true, _count: { select: { memberships: true } } },
  });
  if (!user || user._count.memberships > 0) return null;
  return createOrgForUser(db, { name: user.name || user.email, userId });
}

export async function renameOrg(
  db: PrismaClient,
  args: { orgId: string; actorUserId: string; name: string }
): Promise<SimpleResult<"not-owner" | "unchanged">> {
  const name = args.name.trim();
  return withOrg(db, args.orgId).$transaction(
    async (tx): Promise<SimpleResult<"not-owner" | "unchanged">> => {
      await lockMembers(tx, args.orgId);
      if (!(await isOwner(tx, args.actorUserId))) return { ok: false, reason: "not-owner" };
      const org = await tx.org.findUniqueOrThrow({
        where: { id: args.orgId },
        select: { name: true },
      });
      if (org.name === name) return { ok: false, reason: "unchanged" };
      await tx.org.update({ where: { id: args.orgId }, data: { name } });
      await recordEvent(tx, args.orgId, {
        type: "org_renamed",
        actorUserId: args.actorUserId,
        detail: `${org.name} → ${name}`,
      });
      return { ok: true };
    }
  );
}

export interface InviteLookup {
  id: string;
  orgId: string;
  orgName: string;
  email: string;
  role: OrgRole;
  inviterName: string | null;
  expiresAt: Date;
  status: InviteStatus;
}

/**
 * The invite behind a link, found by the token's hash before any org is known: the one
 * tenant read of OrgInvite outside withOrg (like `findScanTokenByHash`).
 */
export async function findInviteByToken(
  db: PrismaClient,
  token: string,
  now = new Date()
): Promise<InviteLookup | null> {
  if (!isInviteToken(token)) return null;
  const row = await db.orgInvite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: {
      id: true,
      orgId: true,
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      org: { select: { name: true } },
      invitedBy: { select: { name: true, email: true } },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    orgId: row.orgId,
    orgName: row.org.name,
    email: row.email,
    role: row.role,
    inviterName: row.invitedBy ? row.invitedBy.name || row.invitedBy.email : null,
    expiresAt: row.expiresAt,
    status: inviteStatus(row, now),
  };
}

export type AcceptInviteResult =
  | { ok: true; orgId: string; orgName: string }
  | {
      ok: false;
      reason: "invalid" | "expired" | "revoked" | "used" | "wrong-email" | "already-member";
      orgId?: string;
    };

/** Joins `userId` to the invite's org when the account's email is the invited address. */
export async function acceptInvite(
  db: PrismaClient,
  args: { token: string; userId: string; now?: Date }
): Promise<AcceptInviteResult> {
  const now = args.now ?? new Date();
  const found = await findInviteByToken(db, args.token, now);
  if (!found) return { ok: false, reason: "invalid" };
  const user = await db.user.findUnique({ where: { id: args.userId }, select: { email: true } });
  if (!user) return { ok: false, reason: "invalid" };
  const orgId = found.orgId;
  return withOrg(db, orgId).$transaction(async (tx): Promise<AcceptInviteResult> => {
    await lockMembers(tx, orgId);
    if ((await tx.orgMember.count({ where: { userId: args.userId } })) > 0) {
      return { ok: false, reason: "already-member", orgId };
    }
    // Re-read under the lock: a revoke, resend or second accept may have run meanwhile.
    const invite = await tx.orgInvite.findFirst({
      where: { id: found.id, tokenHash: hashInviteToken(args.token) },
      select: { email: true, role: true, acceptedAt: true, revokedAt: true, expiresAt: true },
    });
    if (!invite) return { ok: false, reason: "invalid" };
    const status = inviteStatus(invite, now);
    if (status === "accepted") return { ok: false, reason: "used" };
    if (status !== "pending") return { ok: false, reason: status };
    if (normalizeEmail(user.email) !== invite.email) return { ok: false, reason: "wrong-email" };
    await tx.orgMember.create({ data: { orgId, userId: args.userId, role: invite.role } });
    await tx.orgInvite.update({ where: { id: found.id }, data: { acceptedAt: now } });
    await recordEvent(tx, orgId, {
      type: "invite_accepted",
      actorUserId: args.userId,
      targetUserId: args.userId,
      targetEmail: invite.email,
      detail: invite.role,
    });
    return { ok: true, orgId, orgName: found.orgName };
  });
}

export interface MemberRow {
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
  joinedAt: Date;
  verified: boolean;
}

export interface InviteRow {
  id: string;
  email: string;
  role: OrgRole;
  sentAt: Date;
  expiresAt: Date;
  expired: boolean;
}

export interface EventRow {
  id: string;
  type: OrgEventType;
  actor: string | null;
  targetEmail: string | null;
  detail: string | null;
  createdAt: Date;
}

export async function loadMembers(db: PrismaClient, orgId: string): Promise<MemberRow[]> {
  const rows = await withOrg(db, orgId).orgMember.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      role: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true, emailVerified: true } },
    },
  });
  return rows.map((m) => ({
    userId: m.user.id,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    joinedAt: m.createdAt,
    verified: m.user.emailVerified,
  }));
}

/** Invites an owner can still act on: pending ones and expired ones (Resend renews them). */
export async function loadOpenInvites(
  db: PrismaClient,
  orgId: string,
  now = new Date()
): Promise<InviteRow[]> {
  const rows = await withOrg(db, orgId).orgInvite.findMany({
    where: { acceptedAt: null, revokedAt: null },
    orderBy: { sentAt: "desc" },
    select: { id: true, email: true, role: true, sentAt: true, expiresAt: true },
  });
  return rows.map((r) => ({ ...r, expired: r.expiresAt.getTime() <= now.getTime() }));
}

export async function loadOrgEvents(db: PrismaClient, orgId: string): Promise<EventRow[]> {
  const rows = await withOrg(db, orgId).orgEvent.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: EVENTS_SHOWN,
    select: {
      id: true,
      type: true,
      targetEmail: true,
      detail: true,
      createdAt: true,
      actor: { select: { name: true, email: true } },
    },
  });
  return rows.map(({ actor, ...r }) => ({
    ...r,
    actor: actor ? actor.name || actor.email : null,
  }));
}
