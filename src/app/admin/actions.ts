"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdminContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { renderTestEmail } from "@/lib/email/alert-email";
import { sendMail } from "@/lib/email/mailer";
import { PRODUCT_LANGUAGE } from "@/lib/i18n";
import { getEnv } from "@/lib/env";
import { enqueueJob } from "@/lib/jobs/queue";
import { log } from "@/lib/log";

import { RUNNABLE_JOB_TYPES } from "./job-types";

export interface AdminState {
  ok: boolean;
  message: string | null;
}

const jobSchema = z.enum(RUNNABLE_JOB_TYPES);

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
