"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { log } from "@/lib/log";
import { markOnboarded } from "@/lib/member-state";
import { ensureNamedScanToken } from "@/lib/scan/token-store";

import { loadConnectData, loadScanStatus } from "./loaders";
import {
  type ConnectData,
  ONBOARDING_TOKEN_NAMES,
  type OnboardingToken,
  type ScanMethod,
  type ScanStatus,
} from "./scan-status";

/** Polled by onboarding and the Connect repos sheet while they are open. */
export async function scanStatusAction(): Promise<ScanStatus> {
  const ctx = await requireOrgContext();
  return loadScanStatus(ctx.orgId);
}

/**
 * Creates the method's token ("GitHub Action" / "Local scanner") once: an active one
 * with that name is reused, and then its secret cannot be shown again.
 */
export async function ensureOnboardingTokenAction(method: ScanMethod): Promise<OnboardingToken> {
  const ctx = await requireOrgContext();
  if (method !== "action" && method !== "local") throw new Error("Unknown scan method");
  const { token, secret, created } = await ensureNamedScanToken(getDb(), ctx.orgId, {
    name: ONBOARDING_TOKEN_NAMES[method],
    userId: ctx.userId,
  });
  if (created) {
    log.info({ orgId: ctx.orgId, userId: ctx.userId, tokenId: token.id }, "scan token created");
    // The sheet can be open on Settings, whose token list must show the new token.
    revalidatePath("/settings");
  }
  return { name: token.name, prefix: token.prefix, secret };
}

/** Loads the Connect repos sheet when it opens (not on every page render). */
export async function connectDataAction(): Promise<ConnectData> {
  const ctx = await requireOrgContext();
  return loadConnectData(ctx.orgId);
}

/** Skip or Continue: onboarding is shown once, then the sheet in the top bar takes over. */
export async function finishOnboardingAction(): Promise<void> {
  const ctx = await requireOrgContext();
  await markOnboarded(getDb(), ctx.orgId, ctx.userId);
  redirect("/");
}
