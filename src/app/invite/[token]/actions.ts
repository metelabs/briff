"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/lib/auth/auth";
import { getSessionUser, ORG_COOKIE } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { isInviteToken } from "@/lib/invite-token";
import { log } from "@/lib/log";
import { acceptInvite } from "@/lib/members";
import { STREAM_COOKIE } from "@/lib/stream-scope";

export interface JoinState {
  ok: boolean;
  message: string | null;
}

const REASONS: Record<string, string> = {
  invalid: "This invite link is not valid.",
  expired: "This invite expired. Ask for a new one.",
  revoked: "This invite was revoked.",
  used: "This invite was already used.",
  "wrong-email": "This invite is for another email address.",
  "already-member": "You are already a member.",
};

/** "Join" on /invite/<token> for a signed-in account with the invited address. */
export async function joinInviteAction(_prev: JoinState, form: FormData): Promise<JoinState> {
  const user = await getSessionUser();
  const token = String(form.get("token") ?? "");
  if (!isInviteToken(token)) return { ok: false, message: REASONS.invalid };
  if (!user) redirect(`/invite/${token}`);
  const res = await acceptInvite(getDb(), { token, userId: user.userId });
  if (!res.ok) {
    if (res.reason === "already-member") redirect(`/invite/${token}`);
    return { ok: false, message: REASONS[res.reason] };
  }
  log.info({ userId: user.userId, orgId: res.orgId }, "invite accepted");
  const jar = await cookies();
  jar.set(ORG_COOKIE, res.orgId, {
    path: "/",
    maxAge: 31_536_000,
    sameSite: "lax",
    httpOnly: true,
  });
  jar.delete(STREAM_COOKIE);
  redirect("/?joined=1");
}

/** Signed in with another account: sign out and come back to the same invite. */
export async function signOutForInviteAction(token: string): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect(isInviteToken(token) ? `/invite/${token}` : "/login");
}
