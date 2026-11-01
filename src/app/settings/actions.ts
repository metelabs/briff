"use server";

import { APIError } from "better-auth/api";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getAuth, VERIFIED_CALLBACK } from "@/lib/auth/auth";
import { requireOrgContext } from "@/lib/auth/session";
import { endSubscriptions } from "@/lib/billing/manage";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { log } from "@/lib/log";
import { deleteOrg } from "@/lib/org-data";
import { createScanToken, revokeScanToken } from "@/lib/scan/token-store";
import { SCAN_TOKEN_NAME_MAX } from "@/lib/scan/tokens";

export interface FormState {
  ok: boolean;
  message: string | null;
  /**
   * The value as saved. React resets a form after its action runs, back to each
   * field's default; a default that never updates (a <select> ignores a new
   * defaultValue, which is how the language picker showed the old value) shows
   * the stale value. The client uses this as the default instead.
   */
  saved?: string;
}

const profileSchema = z.object({ text: z.string().max(2000) });

export async function saveProfileTextAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await requireOrgContext();
  const parsed = profileSchema.safeParse({ text: form.get("text") ?? "" });
  if (!parsed.success) return { ok: false, message: "At most 2000 characters." };
  const db = withOrg(getDb(), ctx.orgId);
  const existing = await db.interestProfile.findFirst({ select: { id: true } });
  const text = parsed.data.text.trim();
  if (existing) await db.interestProfile.update({ where: { id: existing.id }, data: { text } });
  else await db.interestProfile.create({ data: { orgId: ctx.orgId, text } });
  revalidatePath("/settings");
  return { ok: true, message: "Profile saved.", saved: text };
}

const deliverySchema = z.object({ deliveryEmail: z.union([z.literal(""), z.email()]) });

export async function saveDeliveryAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await requireOrgContext();
  const parsed = deliverySchema.safeParse({
    deliveryEmail: String(form.get("deliveryEmail") ?? "").trim(),
  });
  if (!parsed.success)
    return { ok: false, message: "Enter a valid email address or leave it empty." };
  // The user row is the signed-in user's own (not tenant data).
  await getDb().user.update({
    where: { id: ctx.userId },
    data: { deliveryEmail: parsed.data.deliveryEmail === "" ? null : parsed.data.deliveryEmail },
  });
  revalidatePath("/settings");
  return { ok: true, message: "Delivery settings saved.", saved: parsed.data.deliveryEmail };
}

export interface ScanTokenFormState extends FormState {
  /** The new token's secret; shown once by the dialog and never readable again. */
  secret?: string;
  name?: string;
}

const scanTokenNameSchema = z
  .string()
  .trim()
  .min(1, "Give the token a name.")
  .max(SCAN_TOKEN_NAME_MAX, `At most ${SCAN_TOKEN_NAME_MAX} characters.`);

export async function createScanTokenAction(
  _prev: ScanTokenFormState,
  form: FormData
): Promise<ScanTokenFormState> {
  const ctx = await requireOrgContext();
  const raw = String(form.get("name") ?? "");
  const parsed = scanTokenNameSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid name.", saved: raw };
  }
  const { token, secret } = await createScanToken(getDb(), ctx.orgId, {
    name: parsed.data,
    userId: ctx.userId,
  });
  log.info({ orgId: ctx.orgId, userId: ctx.userId, tokenId: token.id }, "scan token created");
  revalidatePath("/settings");
  return { ok: true, message: null, secret, name: token.name };
}

export async function revokeScanTokenAction(id: string): Promise<{ ok: boolean }> {
  const ctx = await requireOrgContext();
  const ok = await revokeScanToken(getDb(), ctx.orgId, id, new Date());
  if (ok) log.info({ orgId: ctx.orgId, userId: ctx.userId, tokenId: id }, "scan token revoked");
  revalidatePath("/settings");
  return { ok };
}

export async function deleteOrgAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await requireOrgContext();
  const confirmName = String(form.get("confirmName") ?? "");
  const res = await deleteOrg(getDb(), {
    orgId: ctx.orgId,
    userId: ctx.userId,
    confirmName,
    beforeDelete: () => endSubscriptions(getDb(), ctx.orgId),
  });
  if (!res.ok) {
    return {
      ok: false,
      message:
        res.reason === "billing"
          ? res.message
          : res.reason === "not-owner"
            ? "Only an owner can delete this organisation."
            : res.reason === "instance-admin"
              ? "You run this instance and other accounts exist on it. Deleting your account would make the next account its admin, so it is not possible here."
              : "The name does not match.",
      saved: confirmName,
    };
  }
  log.info({ orgId: ctx.orgId, userId: ctx.userId, userDeleted: res.userDeleted }, "org deleted");
  if (!res.userDeleted) redirect("/");
  // The user and its sessions are gone; drop the now-dead session cookies too.
  const jar = await cookies();
  for (const c of jar.getAll()) if (c.name.includes("better-auth")) jar.delete(c.name);
  redirect("/login?deleted=1");
}

function authError(err: unknown, fallback: string): string {
  if (err instanceof APIError) {
    if (err.status === "TOO_MANY_REQUESTS") return "Too many attempts. Try again in one hour.";
    if (err.body?.code === "INVALID_PASSWORD") return "The current password is wrong.";
  }
  return fallback;
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password.").max(128),
  newPassword: z
    .string()
    .min(12, "The new password needs at least 12 characters.")
    .max(128, "At most 128 characters."),
});

export async function changePasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await requireOrgContext();
  const parsed = changePasswordSchema.safeParse({
    currentPassword: String(form.get("currentPassword") ?? ""),
    newPassword: String(form.get("newPassword") ?? ""),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    await getAuth().api.changePassword({
      body: { ...parsed.data, revokeOtherSessions: true },
      headers: await headers(),
    });
  } catch (err) {
    log.warn({ err, userId: ctx.userId }, "auth: change password failed");
    return { ok: false, message: authError(err, "Could not change the password.") };
  }
  log.info({ userId: ctx.userId }, "auth: password changed");
  // The request's session was revoked with the others; re-rendering here would read it and
  // bounce through /login. Navigate instead, so the next render carries the new cookie.
  redirect("/settings?password=changed#account");
}

export async function changeEmailAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await requireOrgContext();
  const raw = String(form.get("newEmail") ?? "").trim();
  const parsed = z.email().safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Enter a valid email address.", saved: raw };
  if (parsed.data.toLowerCase() === ctx.email.toLowerCase()) {
    return { ok: false, message: "That is already your account email.", saved: raw };
  }
  try {
    await getAuth().api.changeEmail({
      body: { newEmail: parsed.data, callbackURL: VERIFIED_CALLBACK },
      headers: await headers(),
    });
  } catch (err) {
    log.warn({ err, userId: ctx.userId }, "auth: change email failed");
    return { ok: false, message: authError(err, "Could not start the change."), saved: raw };
  }
  log.info({ userId: ctx.userId }, "auth: email change requested");
  return {
    ok: true,
    message: `We sent a link to ${parsed.data}. Your email changes once you open it.`,
    saved: "",
  };
}
