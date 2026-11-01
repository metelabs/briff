"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { ORG_COOKIE, type OrgContext, requireOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { type InviteDelivery, deliverInvite } from "@/lib/invite-delivery";
import { log } from "@/lib/log";
import {
  assertMemberCapacity,
  loadOrgLimits,
  memberLimitMessage,
  OrgLimitError,
} from "@/lib/org-limits";
import {
  changeMemberRole,
  createInvite,
  INVITES_PER_DAY,
  leaveOrg,
  ORG_NAME_MAX,
  removeMember,
  renameOrg,
  resendInvite,
  revokeInvite,
} from "@/lib/members";
import { STREAM_COOKIE } from "@/lib/stream-scope";

import type { FormState } from "./actions";

// Settings -> Organisation and Members. Every action re-checks the role inside the
// transaction (src/lib/members.ts); the page hiding a control is never the guard.

export interface InviteFormState extends FormState {
  /** Without SMTP: the link the owner passes on by hand. */
  link?: string;
}

const NOT_OWNER = "Only an owner can do that.";
const RATE_LIMITED = `This organisation sent ${INVITES_PER_DAY} invites in the last 24 hours. Try again tomorrow.`;
const roleSchema = z.enum(["owner", "member"]);
const inviteSchema = z.object({ email: z.email().max(254), role: roleSchema });

async function orgName(orgId: string): Promise<string> {
  const org = await getDb().org.findUniqueOrThrow({ where: { id: orgId }, select: { name: true } });
  return org.name;
}

function deliveryMessage(email: string, delivery: InviteDelivery, verb: string): InviteFormState {
  if (delivery.status === "sent") return { ok: true, message: `${verb} ${email}.`, saved: "" };
  if (delivery.status === "no-smtp") {
    return {
      ok: true,
      message: `Email is not set up on this instance. Send ${email} this link yourself.`,
      saved: "",
      link: delivery.link,
    };
  }
  return {
    ok: false,
    message: `The invite for ${email} is saved but the email could not be sent. Try Resend in a minute.`,
    saved: "",
  };
}

async function send(
  ctx: OrgContext,
  invite: {
    inviteId?: string;
    email: string;
    token: string;
    role: "owner" | "member";
    expiresAt: Date;
  }
): Promise<InviteDelivery> {
  return deliverInvite({
    orgId: ctx.orgId,
    inviteId: invite.inviteId,
    to: invite.email,
    token: invite.token,
    inviterName: ctx.name || ctx.email,
    orgName: await orgName(ctx.orgId),
    role: invite.role,
    expiresAt: invite.expiresAt,
  });
}

export async function inviteMemberAction(
  _prev: InviteFormState,
  form: FormData
): Promise<InviteFormState> {
  const ctx = await requireOrgContext();
  const raw = String(form.get("email") ?? "").trim();
  const parsed = inviteSchema.safeParse({ email: raw, role: form.get("role") ?? "member" });
  if (!parsed.success) return { ok: false, message: "Enter a valid email address.", saved: raw };
  // The role is rechecked in the transaction; this only puts the clearer message first.
  if (ctx.role !== "owner") return { ok: false, message: NOT_OWNER, saved: raw };
  try {
    await assertMemberCapacity(ctx.orgId);
  } catch (err) {
    if (err instanceof OrgLimitError) return { ok: false, message: err.message, saved: raw };
    throw err;
  }
  const res = await createInvite(getDb(), {
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    email: parsed.data.email,
    role: parsed.data.role,
  });
  if (!res.ok) {
    if (res.reason === "member-limit") {
      return { ok: false, message: memberLimitMessage(res.limits), saved: raw };
    }
    const message = {
      "not-owner": NOT_OWNER,
      "already-member": `${parsed.data.email} is already a member.`,
      "already-invited": `${parsed.data.email} already has a pending invite. Use Resend below.`,
      "rate-limited": RATE_LIMITED,
    }[res.reason];
    return { ok: false, message, saved: raw };
  }
  log.info({ orgId: ctx.orgId, userId: ctx.userId, inviteId: res.inviteId }, "invite created");
  const delivery = await send(ctx, { ...res, role: parsed.data.role });
  revalidatePath("/settings");
  return deliveryMessage(res.email, delivery, "Invite sent to");
}

export async function resendInviteAction(inviteId: string): Promise<InviteFormState> {
  const ctx = await requireOrgContext();
  const parsed = z.string().min(1).max(100).safeParse(inviteId);
  if (!parsed.success) return { ok: false, message: "That invite no longer exists." };
  const res = await resendInvite(getDb(), {
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    inviteId: parsed.data,
  });
  if (!res.ok) {
    revalidatePath("/settings");
    if (res.reason === "member-limit")
      return { ok: false, message: memberLimitMessage(res.limits) };
    const message = {
      "not-owner": NOT_OWNER,
      "not-found": "That invite was already accepted or revoked.",
      "already-member": "That address is already a member.",
      "already-invited": "That address has a newer pending invite. Resend that one instead.",
      "rate-limited": RATE_LIMITED,
    }[res.reason];
    revalidatePath("/settings");
    return { ok: false, message };
  }
  const delivery = await send(ctx, { inviteId: parsed.data, ...res });
  revalidatePath("/settings");
  return deliveryMessage(res.email, delivery, "Sent a new link to");
}

export async function revokeInviteAction(inviteId: string): Promise<FormState> {
  const ctx = await requireOrgContext();
  const parsed = z.string().min(1).max(100).safeParse(inviteId);
  if (!parsed.success) return { ok: false, message: "That invite no longer exists." };
  const res = await revokeInvite(getDb(), {
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    inviteId: parsed.data,
  });
  revalidatePath("/settings");
  if (!res.ok) {
    return {
      ok: false,
      message:
        res.reason === "not-owner" ? NOT_OWNER : "That invite was already accepted or revoked.",
    };
  }
  return { ok: true, message: "Invite revoked. Its link no longer works." };
}

const LAST_OWNER = "An organisation needs at least one owner. Make someone else an owner first.";

export async function changeRoleAction(memberUserId: string, role: string): Promise<FormState> {
  const ctx = await requireOrgContext();
  const parsed = z
    .object({ memberUserId: z.string().min(1).max(100), role: roleSchema })
    .safeParse({ memberUserId, role });
  if (!parsed.success) return { ok: false, message: "Invalid role." };
  const res = await changeMemberRole(getDb(), {
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    ...parsed.data,
  });
  revalidatePath("/settings");
  if (!res.ok) {
    const message = {
      "not-owner": NOT_OWNER,
      "not-found": "That person is no longer a member.",
      "last-owner": LAST_OWNER,
      self: NOT_OWNER,
      unchanged: null,
    }[res.reason];
    return { ok: res.reason === "unchanged", message };
  }
  log.info({ orgId: ctx.orgId, userId: ctx.userId, memberUserId, role }, "member role changed");
  // Demoting yourself: the page re-renders without the owner controls.
  return { ok: true, message: parsed.data.role === "owner" ? "Now an owner." : "Now a member." };
}

export async function removeMemberAction(memberUserId: string): Promise<FormState> {
  const ctx = await requireOrgContext();
  const parsed = z.string().min(1).max(100).safeParse(memberUserId);
  if (!parsed.success) return { ok: false, message: "That person is no longer a member." };
  const res = await removeMember(getDb(), {
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    memberUserId: parsed.data,
  });
  revalidatePath("/settings");
  if (!res.ok) {
    const message = {
      "not-owner": NOT_OWNER,
      "not-found": "That person is no longer a member.",
      "last-owner": LAST_OWNER,
      self: "To leave, use Leave organisation.",
    }[res.reason];
    return { ok: false, message };
  }
  log.info({ orgId: ctx.orgId, userId: ctx.userId, memberUserId }, "member removed");
  return { ok: true, message: "Removed. They no longer get this organisation's email." };
}

async function forgetOrgChoice(): Promise<void> {
  const jar = await cookies();
  jar.delete(ORG_COOKIE);
  jar.delete(STREAM_COOKIE);
}

export async function leaveOrgAction(): Promise<FormState> {
  const ctx = await requireOrgContext();
  const res = await leaveOrg(getDb(), { orgId: ctx.orgId, userId: ctx.userId });
  if (!res.ok) {
    return {
      ok: false,
      message:
        res.reason === "last-owner"
          ? "You are the only owner. Make someone else an owner, or delete the organisation."
          : "You are no longer a member.",
    };
  }
  log.info({ orgId: ctx.orgId, userId: ctx.userId }, "member left org");
  await forgetOrgChoice();
  redirect("/?left=1");
}

const orgNameSchema = z
  .string()
  .trim()
  .min(1, "Give the organisation a name.")
  .max(ORG_NAME_MAX, `At most ${ORG_NAME_MAX} characters.`);

export async function renameOrgAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await requireOrgContext();
  const raw = String(form.get("name") ?? "");
  const parsed = orgNameSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid name.", saved: raw };
  }
  const res = await renameOrg(getDb(), {
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    name: parsed.data,
  });
  if (!res.ok && res.reason === "not-owner") return { ok: false, message: NOT_OWNER, saved: raw };
  revalidatePath("/", "layout");
  return { ok: true, message: "Organisation renamed.", saved: parsed.data };
}
