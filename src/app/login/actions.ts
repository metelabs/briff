"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";
import { z } from "zod";

import { getAuth, RESET_PASSWORD_PATH, VERIFIED_CALLBACK } from "@/lib/auth/auth";
import { withInviteSignup } from "@/lib/auth/invite-signup";
import { ORG_COOKIE } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { isInviteToken } from "@/lib/invite-token";
import { log } from "@/lib/log";
import { acceptInvite, findInviteByToken, memberRole } from "@/lib/members";
import { STREAM_COOKIE } from "@/lib/stream-scope";

export interface AuthFormState {
  error: string | null;
}

const signInSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

const signUpSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email(),
  password: z.string().min(12, "Password must be at least 12 characters."),
});

function messageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong.";
}

/** The invite token a form from /invite/<token> carries, or null. */
function inviteOf(form: FormData): string | null {
  const token = form.get("invite");
  return typeof token === "string" && isInviteToken(token) ? token : null;
}

/** Lands in the invite's org once the account is a member of it. */
async function openInvitedOrg(orgId: string): Promise<never> {
  const jar = await cookies();
  jar.set(ORG_COOKIE, orgId, { path: "/", maxAge: 31_536_000, sameSite: "lax", httpOnly: true });
  jar.delete(STREAM_COOKIE);
  redirect("/?joined=1");
}

export async function signInAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Enter your email and password." };
  let userId: string;
  try {
    const res = await getAuth().api.signInEmail({ body: parsed.data, headers: await headers() });
    userId = res.user.id;
  } catch (err) {
    log.warn({ err }, "auth: sign-in failed");
    return { error: "Invalid email or password." };
  }
  const invite = inviteOf(form);
  if (invite) {
    const joined = await acceptInvite(getDb(), { token: invite, userId });
    if (joined.ok) await openInvitedOrg(joined.orgId);
    // Wrong account, expired, already a member: the invite page explains it.
    redirect(`/invite/${invite}`);
  }
  redirect("/");
}

export async function signUpAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const token = inviteOf(form);
  const invite = token ? await findInviteByToken(getDb(), token) : null;
  if (token && invite?.status !== "pending") {
    return { error: "This invite is no longer valid. Ask for a new one." };
  }
  // An invite decides the address; the hooks in auth.ts let it in and join its org.
  const body = {
    ...parsed.data,
    email: invite?.email ?? parsed.data.email,
    callbackURL: VERIFIED_CALLBACK,
  };
  const requestHeaders = await headers();
  const signUp = () => getAuth().api.signUpEmail({ body, headers: requestHeaders });
  let userId: string;
  try {
    const res =
      token && invite
        ? await withInviteSignup({ token, email: invite.email }, signUp)
        : await signUp();
    userId = res.user.id;
  } catch (err) {
    log.warn({ err }, "auth: sign-up failed");
    return { error: messageOf(err) };
  }
  if (invite && (await memberRole(getDb(), invite.orgId, userId))) {
    await openInvitedOrg(invite.orgId);
  }
  redirect("/");
}

export interface ResetRequestState {
  sent: boolean;
  message: string | null;
}

const RESET_SENT_ANSWER =
  "If an account exists for that address, we sent a link to reset its password.";

function tooManyAttempts(err: unknown): boolean {
  return err instanceof APIError && err.status === "TOO_MANY_REQUESTS";
}

export async function requestPasswordResetAction(
  _prev: ResetRequestState,
  form: FormData
): Promise<ResetRequestState> {
  const parsed = z.email().safeParse(String(form.get("email") ?? "").trim());
  if (!parsed.success) return { sent: false, message: "Enter a valid email address." };
  try {
    await getAuth().api.requestPasswordReset({
      body: { email: parsed.data, redirectTo: RESET_PASSWORD_PATH },
      headers: await headers(),
    });
  } catch (err) {
    if (tooManyAttempts(err))
      return { sent: false, message: "Too many attempts. Try again in one hour." };
    log.warn({ err }, "auth: password reset request failed");
    return { sent: false, message: "Something went wrong. Try again in a minute." };
  }
  return { sent: true, message: RESET_SENT_ANSWER };
}

const resetSchema = z.object({
  token: z.string().min(1),
  password: z
    .string()
    .min(12, "Password must be at least 12 characters.")
    .max(128, "At most 128 characters."),
});

export async function resetPasswordAction(
  _prev: AuthFormState,
  form: FormData
): Promise<AuthFormState> {
  const parsed = resetSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  try {
    await getAuth().api.resetPassword({
      body: { token: parsed.data.token, newPassword: parsed.data.password },
      headers: await headers(),
    });
  } catch (err) {
    log.warn({ err }, "auth: password reset failed");
    return { error: "This reset link is invalid or has expired. Ask for a new one." };
  }
  redirect("/login?reset=1");
}

export async function signOutAction(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/login");
}
