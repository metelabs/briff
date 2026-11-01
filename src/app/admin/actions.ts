"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdminContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { renderTestEmail } from "@/lib/email/alert-email";
import { sendMail } from "@/lib/email/mailer";
import { PRODUCT_LANGUAGE } from "@/lib/i18n";
import { getEnv, isCloud } from "@/lib/env";
import { enqueueJob } from "@/lib/jobs/queue";
import { log } from "@/lib/log";
import { PLAN_IDS, PLANS, type PlanId } from "@/lib/plans";

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

export interface OrgPlanSettings {
  plan: PlanId;
  /** Overrides; null = the plan's limit. */
  repoLimit: number | null;
  streamLimit: number | null;
}

export interface LimitsState extends AdminState {
  /** What was saved, so the reopened dialog shows it (see FormState.saved in settings). */
  saved?: OrgPlanSettings;
}

/** An empty or missing field clears the override. */
const override = (max: number) =>
  z.preprocess(
    // A disabled field (the plan is unlimited there) is not submitted at all.
    (v) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v),
    z.coerce.number().int().min(1).max(max).nullable()
  );

const planSchema = z.object({
  orgId: z.string().min(1),
  plan: z.enum(PLAN_IDS),
  repoLimit: override(100000),
  streamLimit: override(10000),
});

export async function saveOrgPlanAction(_prev: LimitsState, form: FormData): Promise<LimitsState> {
  await requireAdminContext();
  if (!isCloud())
    return { ok: false, message: "Plans and limits are off on this instance (BRIFF_CLOUD)." };
  const parsed = planSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return { ok: false, message: "Pick a plan; overrides are empty or positive whole numbers." };
  const { orgId, plan, repoLimit, streamLimit } = parsed.data;
  const db = getDb();
  const saved = await db.$transaction(async (tx) => {
    const org = await tx.org.findUnique({ where: { id: orgId }, select: { plan: true } });
    if (!org) return false;
    await tx.org.update({
      where: { id: orgId },
      data: {
        plan,
        repoLimit,
        streamLimit,
        ...(org.plan !== plan ? { planUpdatedAt: new Date() } : {}),
      },
    });
    return true;
  });
  if (!saved) return { ok: false, message: "Organisation not found." };
  revalidatePath("/admin");
  revalidatePath("/repos");
  revalidatePath("/settings");
  return {
    ok: true,
    message: `Saved: ${PLANS[plan].name} plan. Rescan any repositories previously skipped.`,
    saved: { plan, repoLimit, streamLimit },
  };
}
