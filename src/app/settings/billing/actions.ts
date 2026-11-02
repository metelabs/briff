"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getBillingApi } from "@/lib/billing/api";
import { BILLING_INTERVALS, PAID_PLAN_IDS } from "@/lib/billing/catalog";
import { billingConfig } from "@/lib/billing/config";
import * as manage from "@/lib/billing/manage";
import { requireOrgContext, type OrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";

// Settings -> Billing. Thin wrappers: src/lib/billing/manage.ts checks the role and the
// subscription's org for every call.

const termsSchema = z.object({ plan: z.enum(PAID_PLAN_IDS), interval: z.enum(BILLING_INTERVALS) });
const NOT_CONFIGURED = {
  ok: false as const,
  message: "Billing is not configured on this instance.",
};

function setup(ctx: OrgContext) {
  const config = billingConfig();
  const api = getBillingApi();
  const actor = { orgId: ctx.orgId, userId: ctx.userId, email: ctx.email };
  return config && api ? { config, api, actor } : null;
}

function done<T extends { ok: boolean }>(result: T): T {
  if (result.ok) revalidatePath("/settings/billing");
  return result;
}

export async function previewPlanChangeAction(input: unknown) {
  const ctx = await requireOrgContext();
  const s = setup(ctx);
  if (!s) return NOT_CONFIGURED;
  const terms = termsSchema.safeParse(input);
  if (!terms.success)
    return { ok: false as const, message: "Pick Pro or Team, monthly or yearly." };
  return manage.previewPlanChange(getDb(), s.api, s.config.env, s.actor, terms.data);
}

export async function changePlanAction(input: unknown) {
  const ctx = await requireOrgContext();
  const s = setup(ctx);
  if (!s) return NOT_CONFIGURED;
  const terms = termsSchema.safeParse(input);
  if (!terms.success)
    return { ok: false as const, message: "Pick Pro or Team, monthly or yearly." };
  return done(await manage.changePlan(getDb(), s.api, s.config.env, s.actor, terms.data));
}

export async function cancelSubscriptionAction() {
  const ctx = await requireOrgContext();
  const s = setup(ctx);
  if (!s) return NOT_CONFIGURED;
  return done(await manage.cancelSubscription(getDb(), s.api, s.config.env, s.actor));
}

export async function resumeSubscriptionAction() {
  const ctx = await requireOrgContext();
  const s = setup(ctx);
  if (!s) return NOT_CONFIGURED;
  return done(await manage.resumeSubscription(getDb(), s.api, s.config.env, s.actor));
}

export async function portalUrlAction() {
  const ctx = await requireOrgContext();
  const s = setup(ctx);
  if (!s) return NOT_CONFIGURED;
  return manage.portalUrl(getDb(), s.api, s.actor);
}

export async function invoiceUrlAction(transactionId: unknown) {
  const ctx = await requireOrgContext();
  const s = setup(ctx);
  if (!s) return NOT_CONFIGURED;
  const id = z
    .string()
    .regex(/^txn_[a-z0-9_]+$/)
    .safeParse(transactionId);
  if (!id.success) return { ok: false as const, message: "That invoice does not exist." };
  return manage.invoiceUrl(getDb(), s.api, s.actor, id.data);
}

export async function startCheckoutAction(input: unknown) {
  const ctx = await requireOrgContext();
  const config = billingConfig();
  if (!config) return NOT_CONFIGURED;
  const terms = termsSchema.safeParse(input);
  if (!terms.success)
    return { ok: false as const, message: "Pick Pro or Team, monthly or yearly." };
  return manage.checkoutSession(
    getDb(),
    config.env,
    { orgId: ctx.orgId, userId: ctx.userId, email: ctx.email },
    terms.data,
    getEnv().BETTER_AUTH_SECRET
  );
}

export async function paymentMethodUrlAction() {
  const ctx = await requireOrgContext();
  const s = setup(ctx);
  if (!s) return NOT_CONFIGURED;
  return manage.paymentMethodUrl(getDb(), s.api, s.actor);
}
