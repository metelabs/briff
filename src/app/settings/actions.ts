"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireOrgContext } from "@/lib/auth/session";
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
  const res = await deleteOrg(getDb(), { orgId: ctx.orgId, userId: ctx.userId, confirmName });
  if (!res.ok) {
    return {
      ok: false,
      message:
        res.reason === "not-owner"
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
