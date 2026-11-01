"use server";

import { APIError } from "better-auth/api";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getAuth, VERIFIED_CALLBACK } from "@/lib/auth/auth";
import { requireOrgContext } from "@/lib/auth/session";
import { log } from "@/lib/log";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { STREAM_COOKIE } from "@/lib/stream-scope";
import { THEME_COOKIE, THEMES, type Theme } from "@/lib/theme";

const YEAR = 60 * 60 * 24 * 365;

/** Stores the theme preference; the next server render sets <html data-theme>. */
export async function setThemeAction(theme: Theme): Promise<{ ok: boolean }> {
  const parsed = z.enum(THEMES).safeParse(theme);
  if (!parsed.success) return { ok: false };
  (await cookies()).set(THEME_COOKIE, parsed.data, {
    path: "/",
    maxAge: YEAR,
    sameSite: "lax",
    httpOnly: true,
  });
  return { ok: true };
}

/** Switches the stream every page is scoped to (top bar picker). */
export async function selectStreamAction(streamId: string): Promise<{ ok: boolean }> {
  const ctx = await requireOrgContext();
  const parsed = z.string().min(1).max(100).safeParse(streamId);
  if (!parsed.success) return { ok: false };
  const stream = await withOrg(getDb(), ctx.orgId).bulletinStream.findFirst({
    where: { id: parsed.data },
    select: { id: true },
  });
  if (!stream) return { ok: false };
  (await cookies()).set(STREAM_COOKIE, stream.id, {
    path: "/",
    maxAge: YEAR,
    sameSite: "lax",
    httpOnly: true,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export interface ResendState {
  ok: boolean;
  message: string | null;
}

/** Sends the signed-in user a fresh verification link (rate limited in the auth hook). */
export async function resendVerificationAction(): Promise<ResendState> {
  const ctx = await requireOrgContext();
  if (ctx.emailVerified) return { ok: true, message: "Your email is already verified." };
  try {
    await getAuth().api.sendVerificationEmail({
      body: { email: ctx.email, callbackURL: VERIFIED_CALLBACK },
      headers: await headers(),
    });
  } catch (err) {
    if (err instanceof APIError && err.status === "TOO_MANY_REQUESTS") {
      return { ok: false, message: "Too many attempts. Try again in one hour." };
    }
    log.warn({ err, userId: ctx.userId }, "auth: resend verification failed");
    return { ok: false, message: "Could not send the email. Try again in a minute." };
  }
  return { ok: true, message: `Sent. Check ${ctx.email}.` };
}
