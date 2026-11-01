import { afterAll, describe, expect, it } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { orgRecipients } from "@/lib/email/recipients";
import { INVITE_TTL_MS } from "@/lib/invite-token";
import { createOrgForUser } from "@/lib/org";

import {
  acceptInvite,
  changeMemberRole,
  countMembers,
  createInvite,
  findInviteByToken,
  INVITES_PER_DAY,
  leaveOrg,
  loadOrgEvents,
  memberRole,
  removeMember,
  renameOrg,
  resendInvite,
  revokeInvite,
} from "./members";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("org members against Postgres", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const users: string[] = [];

  async function user(tag: string, verified = true): Promise<{ id: string; email: string }> {
    const id = `u-mem-${tag}-${suffix}`;
    const email = `mem-${tag}-${suffix}@example.com`;
    await db.user.create({ data: { id, name: `User ${tag}`, email, emailVerified: verified } });
    users.push(id);
    return { id, email };
  }

  async function orgOf(ownerId: string, name: string): Promise<string> {
    return createOrgForUser(db, { name: `${name}-${suffix}`, userId: ownerId });
  }

  async function invite(orgId: string, actorUserId: string, email: string, role = "member") {
    const res = await createInvite(db, {
      orgId,
      actorUserId,
      email,
      role: role === "owner" ? "owner" : "member",
    });
    if (!res.ok) throw new Error(`invite failed: ${res.reason}`);
    return res;
  }

  afterAll(async () => {
    await db.org.deleteMany({ where: { members: { some: { userId: { in: users } } } } });
    await db.org.deleteMany({ where: { name: { endsWith: suffix } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  });

  it("invites, counts the seat, and joins the invited account once", async () => {
    const ada = await user("ada");
    const bob = await user("bob");
    const orgId = await orgOf(ada.id, "acme");
    expect(await countMembers(db, orgId)).toBe(1);

    const sent = await invite(orgId, ada.id, `  ${bob.email.toUpperCase()} `);
    expect(sent.email).toBe(bob.email);
    expect(sent.expiresAt.getTime() - Date.now()).toBeGreaterThan(INVITE_TTL_MS - 60_000);
    expect(await countMembers(db, orgId)).toBe(2);
    // The token itself is never stored.
    const row = await withOrg(db, orgId).orgInvite.findFirstOrThrow({
      where: { id: sent.inviteId },
    });
    expect(row.tokenHash).not.toBe(sent.token);
    expect(JSON.stringify(row)).not.toContain(sent.token);

    expect(
      await createInvite(db, { orgId, actorUserId: ada.id, email: bob.email, role: "member" })
    ).toEqual({ ok: false, reason: "already-invited" });
    expect(
      await createInvite(db, { orgId, actorUserId: ada.id, email: ada.email, role: "member" })
    ).toEqual({ ok: false, reason: "already-member" });

    expect(await acceptInvite(db, { token: sent.token, userId: bob.id })).toEqual({
      ok: true,
      orgId,
      orgName: `acme-${suffix}`,
    });
    expect(await memberRole(db, orgId, bob.id)).toBe("member");
    expect(await countMembers(db, orgId)).toBe(2);
    expect(await acceptInvite(db, { token: sent.token, userId: bob.id })).toMatchObject({
      ok: false,
      reason: "already-member",
    });
    const carol = await user("carol");
    expect(await acceptInvite(db, { token: sent.token, userId: carol.id })).toMatchObject({
      ok: false,
      reason: "used",
    });
    expect((await findInviteByToken(db, sent.token))?.status).toBe("accepted");

    const events = (await loadOrgEvents(db, orgId)).map((e) => e.type);
    expect(events).toEqual(["invite_accepted", "member_invited", "org_created"]);
  });

  it("refuses the wrong account, expired, revoked and unknown links", async () => {
    const ada = await user("ada2");
    const bob = await user("bob2");
    const eve = await user("eve2");
    const orgId = await orgOf(ada.id, "links");

    const forBob = await invite(orgId, ada.id, bob.email);
    expect(await acceptInvite(db, { token: forBob.token, userId: eve.id })).toMatchObject({
      ok: false,
      reason: "wrong-email",
    });
    const later = new Date(Date.now() + INVITE_TTL_MS + 1000);
    expect(
      await acceptInvite(db, { token: forBob.token, userId: bob.id, now: later })
    ).toMatchObject({ ok: false, reason: "expired" });
    expect(await countMembers(db, orgId, later)).toBe(1);

    expect(
      await revokeInvite(db, { orgId, actorUserId: ada.id, inviteId: forBob.inviteId })
    ).toEqual({ ok: true });
    expect(await acceptInvite(db, { token: forBob.token, userId: bob.id })).toMatchObject({
      ok: false,
      reason: "revoked",
    });
    expect(await acceptInvite(db, { token: "x".repeat(43), userId: bob.id })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await acceptInvite(db, { token: "not a token", userId: bob.id })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await memberRole(db, orgId, bob.id)).toBeNull();
    expect(await memberRole(db, orgId, eve.id)).toBeNull();
  });

  it("resend replaces the link and renews an expired invite", async () => {
    const ada = await user("ada3");
    const bob = await user("bob3");
    const orgId = await orgOf(ada.id, "resend");
    const first = await invite(orgId, ada.id, bob.email, "owner");
    await withOrg(db, orgId).orgInvite.updateMany({
      data: { expiresAt: new Date(Date.now() - 1) },
    });

    const again = await resendInvite(db, { orgId, actorUserId: ada.id, inviteId: first.inviteId });
    if (!again.ok) throw new Error(again.reason);
    expect(again.role).toBe("owner");
    expect(await acceptInvite(db, { token: first.token, userId: bob.id })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect((await acceptInvite(db, { token: again.token, userId: bob.id })).ok).toBe(true);
    expect(await memberRole(db, orgId, bob.id)).toBe("owner");

    // An expired invite cannot be renewed next to a newer pending one for the same address.
    const old = await invite(orgId, ada.id, `twice-${suffix}@example.com`);
    await withOrg(db, orgId).orgInvite.updateMany({
      where: { id: old.inviteId },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    await invite(orgId, ada.id, `twice-${suffix}@example.com`);
    expect(await resendInvite(db, { orgId, actorUserId: ada.id, inviteId: old.inviteId })).toEqual({
      ok: false,
      reason: "already-invited",
    });
  });

  it(`limits an org to ${INVITES_PER_DAY} invites a day, resends included`, async () => {
    const ada = await user("ada4");
    const orgId = await orgOf(ada.id, "limit");
    const first = await invite(orgId, ada.id, `x0-${suffix}@example.com`);
    for (let i = 1; i < INVITES_PER_DAY - 1; i++) {
      await invite(orgId, ada.id, `x${i}-${suffix}@example.com`);
    }
    expect(
      (await resendInvite(db, { orgId, actorUserId: ada.id, inviteId: first.inviteId })).ok
    ).toBe(true);
    expect(
      await createInvite(db, {
        orgId,
        actorUserId: ada.id,
        email: `over-${suffix}@example.com`,
        role: "member",
      })
    ).toEqual({ ok: false, reason: "rate-limited" });
    expect(
      await resendInvite(db, { orgId, actorUserId: ada.id, inviteId: first.inviteId })
    ).toEqual({ ok: false, reason: "rate-limited" });
    // Another org has its own allowance.
    const other = await orgOf(ada.id, "limit-other");
    expect(
      (
        await createInvite(db, {
          orgId: other,
          actorUserId: ada.id,
          email: `y-${suffix}@example.com`,
          role: "member",
        })
      ).ok
    ).toBe(true);
  });

  it("only owners invite, change roles, remove and rename", async () => {
    const ada = await user("ada5");
    const bob = await user("bob5");
    const carol = await user("carol5");
    const orgId = await orgOf(ada.id, "roles");
    for (const u of [bob, carol]) {
      const sent = await invite(orgId, ada.id, u.email);
      await acceptInvite(db, { token: sent.token, userId: u.id });
    }
    const pending = await invite(orgId, ada.id, `pending-${suffix}@example.com`);

    const asBob = { orgId, actorUserId: bob.id };
    expect(
      await createInvite(db, { ...asBob, email: `z-${suffix}@example.com`, role: "owner" })
    ).toEqual({ ok: false, reason: "not-owner" });
    expect(await resendInvite(db, { ...asBob, inviteId: pending.inviteId })).toEqual({
      ok: false,
      reason: "not-owner",
    });
    expect(await revokeInvite(db, { ...asBob, inviteId: pending.inviteId })).toEqual({
      ok: false,
      reason: "not-owner",
    });
    expect(await changeMemberRole(db, { ...asBob, memberUserId: bob.id, role: "owner" })).toEqual({
      ok: false,
      reason: "not-owner",
    });
    expect(await removeMember(db, { ...asBob, memberUserId: carol.id })).toEqual({
      ok: false,
      reason: "not-owner",
    });
    expect(await renameOrg(db, { ...asBob, name: "Hijacked" })).toEqual({
      ok: false,
      reason: "not-owner",
    });
    expect(await memberRole(db, orgId, bob.id)).toBe("member");
    expect(await memberRole(db, orgId, carol.id)).toBe("member");

    expect(
      await changeMemberRole(db, {
        orgId,
        actorUserId: ada.id,
        memberUserId: bob.id,
        role: "owner",
      })
    ).toEqual({ ok: true });
    expect(await removeMember(db, { orgId, actorUserId: bob.id, memberUserId: carol.id })).toEqual({
      ok: true,
    });
    expect(await renameOrg(db, { orgId, actorUserId: bob.id, name: `Renamed-${suffix}` })).toEqual({
      ok: true,
    });
    const events = await loadOrgEvents(db, orgId);
    expect(events[0]).toMatchObject({
      type: "org_renamed",
      detail: `roles-${suffix} → Renamed-${suffix}`,
    });
    expect(events[1]).toMatchObject({ type: "member_removed", targetEmail: carol.email });
    expect(events[2]).toMatchObject({
      type: "role_changed",
      targetEmail: bob.email,
      detail: "owner",
    });
  });

  it("never lets the last owner go or be demoted", async () => {
    const ada = await user("ada6");
    const bob = await user("bob6");
    const orgId = await orgOf(ada.id, "last");
    const sent = await invite(orgId, ada.id, bob.email, "owner");
    await acceptInvite(db, { token: sent.token, userId: bob.id });

    // Two owners demoting each other at once: one wins, the org keeps an owner.
    const results = await Promise.all([
      changeMemberRole(db, { orgId, actorUserId: ada.id, memberUserId: bob.id, role: "member" }),
      changeMemberRole(db, { orgId, actorUserId: bob.id, memberUserId: ada.id, role: "member" }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const owners = await withOrg(db, orgId).orgMember.findMany({ where: { role: "owner" } });
    expect(owners).toHaveLength(1);
    const owner = owners[0]?.userId ?? "";
    const other = owner === ada.id ? bob.id : ada.id;

    expect(
      await changeMemberRole(db, { orgId, actorUserId: owner, memberUserId: owner, role: "member" })
    ).toEqual({ ok: false, reason: "last-owner" });
    expect(await leaveOrg(db, { orgId, userId: owner })).toEqual({
      ok: false,
      reason: "last-owner",
    });
    expect(await removeMember(db, { orgId, actorUserId: owner, memberUserId: owner })).toEqual({
      ok: false,
      reason: "self",
    });
    expect(await memberRole(db, orgId, owner)).toBe("owner");

    // A member may leave; with no other org they get a fresh one of their own.
    expect(await leaveOrg(db, { orgId, userId: other })).toEqual({ ok: true });
    expect(await memberRole(db, orgId, other)).toBeNull();
    const own = await db.user.findUniqueOrThrow({
      where: { id: other },
      select: { memberships: { select: { orgId: true, role: true } } },
    });
    expect(own.memberships).toEqual([{ orgId: expect.not.stringMatching(orgId), role: "owner" }]);
    expect((await loadOrgEvents(db, orgId))[0]).toMatchObject({
      type: "member_removed",
      detail: "left",
    });
  });

  it("delivers to a member from joining until removal", async () => {
    const ada = await user("ada7");
    const bob = await user("bob7");
    const orgId = await orgOf(ada.id, "recipients");
    const ownOrg = await orgOf(bob.id, "bob-own");
    const before = await orgRecipients(db, orgId);
    expect(before.map((r) => r.userId)).toEqual([ada.id]);

    const sent = await invite(orgId, ada.id, bob.email);
    // A pending invite gets nothing.
    expect((await orgRecipients(db, orgId)).map((r) => r.userId)).toEqual([ada.id]);
    await acceptInvite(db, { token: sent.token, userId: bob.id });
    expect((await orgRecipients(db, orgId)).map((r) => r.userId)).toEqual([ada.id, bob.id]);

    expect(await removeMember(db, { orgId, actorUserId: ada.id, memberUserId: bob.id })).toEqual({
      ok: true,
    });
    expect((await orgRecipients(db, orgId)).map((r) => r.userId)).toEqual([ada.id]);
    // Bob keeps his own org and gets no new one.
    expect((await orgRecipients(db, ownOrg)).map((r) => r.userId)).toEqual([bob.id]);
    expect(await db.orgMember.count({ where: { userId: bob.id } })).toBe(1);
  });

  it("keeps the 7-day unverified rule for invited members", async () => {
    const ada = await user("ada8");
    const late = await user("late8", false);
    await db.user.update({
      where: { id: late.id },
      data: { createdAt: new Date(Date.now() - 8 * 86_400_000) },
    });
    const orgId = await orgOf(ada.id, "unverified");
    const sent = await invite(orgId, ada.id, late.email);
    await acceptInvite(db, { token: sent.token, userId: late.id });
    expect(await memberRole(db, orgId, late.id)).toBe("member");
    expect((await orgRecipients(db, orgId)).map((r) => r.userId)).toEqual([ada.id]);
  });

  it("keeps every write inside its own org", async () => {
    const ada = await user("ada9");
    const zed = await user("zed9");
    const mine = await orgOf(ada.id, "mine");
    const theirs = await orgOf(zed.id, "theirs");
    const theirInvite = await invite(theirs, zed.id, `t-${suffix}@example.com`);

    // Ada owns `mine` only; ids from `theirs` are not found through it.
    const asAda = { orgId: mine, actorUserId: ada.id };
    expect(await revokeInvite(db, { ...asAda, inviteId: theirInvite.inviteId })).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(await resendInvite(db, { ...asAda, inviteId: theirInvite.inviteId })).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(await removeMember(db, { ...asAda, memberUserId: zed.id })).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(await changeMemberRole(db, { ...asAda, memberUserId: zed.id, role: "member" })).toEqual({
      ok: false,
      reason: "not-found",
    });
    // Acting on `theirs` as a non-member is refused like a member's attempt.
    expect(await renameOrg(db, { orgId: theirs, actorUserId: ada.id, name: "x" })).toEqual({
      ok: false,
      reason: "not-owner",
    });
    expect(
      await revokeInvite(db, { orgId: theirs, actorUserId: ada.id, inviteId: theirInvite.inviteId })
    ).toEqual({ ok: false, reason: "not-owner" });
    expect((await findInviteByToken(db, theirInvite.token))?.status).toBe("pending");
    expect(await memberRole(db, theirs, zed.id)).toBe("owner");
  });
});
