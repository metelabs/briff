"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { sendTestDelivery } from "@/lib/delivery-targets/deliver";
import {
  createDeliveryTarget,
  deleteDeliveryTarget,
  DeliveryTargetError,
  setDeliveryTargetEnabled,
} from "@/lib/delivery-targets/store";
import { log } from "@/lib/log";

import type { FormState } from "./actions";

// Settings -> Integrations. The library re-checks the owner role and the plan inside the org's
// lock (src/lib/delivery-targets/store.ts); the page hiding the form is never the guard.

export interface TargetFormState extends FormState {
  /** A new webhook's signing secret; shown once by the dialog. */
  secret?: string;
  urlLabel?: string;
  kind?: "slack" | "webhook";
  /** The submitted values, so a refused form keeps them (useActionState resets fields). */
  values?: { kind: string; url: string; streamId: string; bulletin: boolean; alert: boolean };
}

const targetSchema = z.object({
  kind: z.enum(["slack", "webhook"]),
  url: z.string().trim().min(1, "Paste the webhook URL.").max(2000),
  streamId: z.string().max(64),
  bulletin: z.boolean(),
  alert: z.boolean(),
});

function failure(err: unknown, fallback: string): string {
  return err instanceof DeliveryTargetError ? err.message : fallback;
}

export async function createDeliveryTargetAction(
  _prev: TargetFormState,
  form: FormData
): Promise<TargetFormState> {
  const ctx = await requireOrgContext();
  const values = {
    kind: String(form.get("kind") ?? "slack"),
    url: String(form.get("url") ?? ""),
    streamId: String(form.get("streamId") ?? ""),
    bulletin: form.get("bulletin") === "on",
    alert: form.get("alert") === "on",
  };
  const parsed = targetSchema.safeParse(values);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input.", values };
  }
  try {
    const created = await createDeliveryTarget(getDb(), {
      orgId: ctx.orgId,
      userId: ctx.userId,
      kind: parsed.data.kind,
      url: parsed.data.url,
      streamId: parsed.data.streamId || null,
      bulletin: parsed.data.bulletin,
      alert: parsed.data.alert,
    });
    log.info({ orgId: ctx.orgId, userId: ctx.userId, targetId: created.id }, "integration added");
    revalidatePath("/settings");
    return {
      ok: true,
      message: null,
      secret: created.secret ?? undefined,
      urlLabel: created.urlLabel,
      kind: parsed.data.kind,
    };
  } catch (err) {
    if (!(err instanceof DeliveryTargetError)) log.error({ err }, "integration: create failed");
    return { ok: false, message: failure(err, "Could not add the integration."), values };
  }
}

export async function setDeliveryTargetEnabledAction(
  id: string,
  enabled: boolean
): Promise<{ ok: boolean; message: string }> {
  const ctx = await requireOrgContext();
  try {
    await setDeliveryTargetEnabled(getDb(), { orgId: ctx.orgId, userId: ctx.userId, id, enabled });
  } catch (err) {
    return { ok: false, message: failure(err, "Could not change the integration.") };
  }
  revalidatePath("/settings");
  return { ok: true, message: enabled ? "Integration turned on" : "Integration turned off" };
}

export async function deleteDeliveryTargetAction(
  id: string
): Promise<{ ok: boolean; message: string }> {
  const ctx = await requireOrgContext();
  try {
    await deleteDeliveryTarget(getDb(), { orgId: ctx.orgId, userId: ctx.userId, id });
  } catch (err) {
    return { ok: false, message: failure(err, "Could not remove the integration.") };
  }
  revalidatePath("/settings");
  return { ok: true, message: "Integration removed" };
}

export async function sendTestDeliveryAction(
  id: string
): Promise<{ ok: boolean; message: string }> {
  const ctx = await requireOrgContext();
  try {
    const res = await sendTestDelivery(getDb(), { orgId: ctx.orgId, userId: ctx.userId, id });
    revalidatePath("/settings");
    return res.ok
      ? { ok: true, message: "Test message delivered" }
      : { ok: false, message: `Test failed: ${res.error}` };
  } catch (err) {
    if (!(err instanceof DeliveryTargetError)) log.error({ err }, "integration: test failed");
    return { ok: false, message: failure(err, "Could not send the test.") };
  }
}
