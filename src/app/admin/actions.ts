"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdminContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { renderTestEmail } from "@/lib/email/alert-email";
import { sendMail } from "@/lib/email/mailer";
import { PRODUCT_LANGUAGE } from "@/lib/i18n";
import { getEnv } from "@/lib/env";
import { enqueueJob } from "@/lib/jobs/queue";
import { JOB_TYPES } from "@/lib/jobs/types";
import { log } from "@/lib/log";
import { PREVIEW_MODELS, previewDedupeKey } from "@/pipeline/preview-payload";

export interface AdminState {
  ok: boolean;
  message: string | null;
}

// bulletin-preview and github-scan need a payload; they are not run from here.
const jobSchema = z.enum(JOB_TYPES).exclude(["bulletin-preview", "github-scan"]);

export async function runJobAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  const ctx = await requireAdminContext();
  const parsed = jobSchema.safeParse(form.get("type"));
  if (!parsed.success) return { ok: false, message: "Unknown job type." };
  const job = await enqueueJob(getDb(), parsed.data, { dedupeKey: parsed.data });
  log.info({ userId: ctx.userId, type: parsed.data, ...job }, "admin: job enqueued");
  revalidatePath("/admin");
  revalidatePath("/admin/runs");
  return {
    ok: true,
    message: job.created
      ? `${parsed.data} queued; the worker picks it up within seconds.`
      : `${parsed.data} is already queued.`,
  };
}

export interface PreviewState extends AdminState {
  /** The submitted values, so the form keeps them after React resets it. */
  streamId?: string;
  model?: string;
}

const previewSchema = z.object({
  streamId: z.string().min(1),
  model: z.enum(PREVIEW_MODELS),
});

export async function previewSynthesisAction(
  _prev: PreviewState,
  form: FormData
): Promise<PreviewState> {
  const ctx = await requireAdminContext();
  const parsed = previewSchema.safeParse({
    streamId: form.get("streamId"),
    model: form.get("model"),
  });
  if (!parsed.success) return { ok: false, message: "Pick a stream and a model." };
  const { streamId, model } = parsed.data;
  const db = getDb();
  const stream = await withOrg(db, ctx.orgId).bulletinStream.findFirst({
    where: { id: streamId },
    select: { name: true },
  });
  if (!stream) return { ok: false, message: "Unknown stream.", streamId, model };
  const payload = { orgId: ctx.orgId, streamId, model };
  const job = await enqueueJob(db, "bulletin-preview", {
    payload,
    dedupeKey: previewDedupeKey(payload),
    maxAttempts: 2,
  });
  log.info({ userId: ctx.userId, ...payload, ...job }, "admin: preview enqueued");
  revalidatePath("/admin");
  return {
    ok: true,
    message: job.created
      ? `Preview of ${stream.name} with ${model} queued; it appears under Bulletins → Previews.`
      : `A preview of ${stream.name} with ${model} is already queued.`,
    streamId,
    model,
  };
}

/** Deletes a preview bulletin (never a real one). */
export async function deletePreviewAction(bulletinId: string): Promise<{ ok: boolean }> {
  const ctx = await requireAdminContext();
  const parsed = z.string().min(1).max(64).safeParse(bulletinId);
  if (!parsed.success) return { ok: false };
  const deleted = await withOrg(getDb(), ctx.orgId).bulletin.deleteMany({
    where: { id: parsed.data, preview: true },
  });
  log.info({ userId: ctx.userId, bulletinId, deleted: deleted.count }, "admin: preview deleted");
  revalidatePath("/admin");
  revalidatePath("/bulletins");
  return { ok: deleted.count === 1 };
}

export async function sendTestEmailAction(): Promise<AdminState> {
  const ctx = await requireAdminContext();
  const user = await getDb().user.findUniqueOrThrow({
    where: { id: ctx.userId },
    select: { email: true, deliveryEmail: true },
  });
  const to = user.deliveryEmail ?? user.email;
  const result = await sendMail({
    to,
    ...renderTestEmail(PRODUCT_LANGUAGE, getEnv().BETTER_AUTH_URL),
  });
  if (result.status === "sent") return { ok: true, message: `Test email sent to ${to}.` };
  if (result.status === "skipped") return { ok: false, message: `Not sent: ${result.reason}.` };
  return { ok: false, message: `Failed: ${result.error}` };
}

export interface LimitsState extends AdminState {
  repoLimit?: number;
  streamLimit?: number;
}

export async function raiseOrgLimitsAction(
  _prev: LimitsState,
  form: FormData
): Promise<LimitsState> {
  await requireAdminContext();
  const parsed = z
    .object({
      orgId: z.string().min(1),
      repoLimit: z.coerce.number().int().min(1).max(100000),
      streamLimit: z.coerce.number().int().min(1).max(10000),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Enter positive whole-number limits." };
  const { orgId, repoLimit, streamLimit } = parsed.data;
  const changed = await getDb().org.updateMany({
    where: { id: orgId, repoLimit: { lte: repoLimit }, streamLimit: { lte: streamLimit } },
    data: { repoLimit, streamLimit },
  });
  if (!changed.count)
    return { ok: false, message: "Organisation not found, or a limit would decrease." };
  revalidatePath("/admin");
  revalidatePath("/repos");
  return {
    ok: true,
    message: "Limits saved. Rescan any repositories previously skipped.",
    repoLimit,
    streamLimit,
  };
}
