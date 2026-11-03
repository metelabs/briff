"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdminContext } from "@/lib/auth/session";
import { lockOrgBilling } from "@/lib/billing/sync";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { renderTestEmail } from "@/lib/email/alert-email";
import { sendMail } from "@/lib/email/mailer";
import { PRODUCT_LANGUAGE } from "@/lib/i18n";
import { getEnv, isCloud } from "@/lib/env";
import { enqueueJob } from "@/lib/jobs/queue";
import { log } from "@/lib/log";
import { planChangeDetail } from "@/lib/org-events";
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
  /** Monthly LLM budget in USD; null = the plan's. */
  llmBudgetUsd: number | null;
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

const budget = z.preprocess(
  (v) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v),
  z.coerce.number().min(0).max(10000).nullable()
);

const planSchema = z.object({
  orgId: z.string().min(1),
  plan: z.enum(PLAN_IDS),
  repoLimit: override(100000),
  streamLimit: override(10000),
  llmBudgetUsd: budget,
});

export async function saveOrgPlanAction(_prev: LimitsState, form: FormData): Promise<LimitsState> {
  const ctx = await requireAdminContext();
  if (!isCloud())
    return { ok: false, message: "Plans and limits are off on this instance (BRIFF_CLOUD)." };
  const parsed = planSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      ok: false,
      message:
        "Pick a plan; overrides are empty or positive whole numbers, the AI budget empty or 0 to 10000 USD.",
    };
  const { orgId, plan, repoLimit, streamLimit } = parsed.data;
  // Cents: the estimate is compared in micro-dollars, the form shows two decimals.
  const llmBudgetUsd =
    parsed.data.llmBudgetUsd === null ? null : Math.round(parsed.data.llmBudgetUsd * 100) / 100;
  const db = getDb();
  // Same lock as billing (src/lib/billing/sync.ts): a webhook cannot interleave with this write.
  const saved = await withOrg(db, orgId).$transaction(async (tx) => {
    await lockOrgBilling(tx, orgId);
    const org = await tx.org.findUnique({ where: { id: orgId }, select: { plan: true } });
    if (!org) return false;
    const changed = org.plan !== plan;
    await tx.org.update({
      where: { id: orgId },
      data: {
        plan,
        repoLimit,
        streamLimit,
        llmBudgetUsd,
        // A plan the admin set is never lowered by billing (planDecision).
        ...(changed ? { planUpdatedAt: new Date(), planSource: "admin" as const } : {}),
      },
    });
    if (changed) {
      await tx.orgEvent.create({
        data: {
          orgId,
          type: "plan_changed",
          actorUserId: ctx.userId,
          detail: planChangeDetail("admin", org.plan, plan),
        },
      });
    }
    return true;
  });
  if (!saved) return { ok: false, message: "Organisation not found." };
  revalidatePath("/admin");
  revalidatePath("/repos");
  revalidatePath("/settings");
  return {
    ok: true,
    message: `Saved: ${PLANS[plan].name} plan. Rescan any repositories previously skipped.`,
    saved: { plan, repoLimit, streamLimit, llmBudgetUsd },
  };
}
