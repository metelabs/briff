import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { normalizeEmail } from "@/lib/invite-token";

// A sign-up from an invite link (/invite/<token>). The invite page's Server Action runs
// `auth.api.signUpEmail` inside `withInviteSignup`, so Better Auth's user hooks know the
// account comes from a checked, pending invite: it may be created on a closed instance
// (ALLOW_SIGNUP=false) and joins the invite's org instead of getting an org of its own.
// It still verifies its email like any sign-up: without SMTP the owner passes the link on
// by hand, so holding it proves nothing about the mailbox.

export interface InviteSignup {
  token: string;
  /** The invite's address; only an account with this email is covered. */
  email: string;
}

const store = new AsyncLocalStorage<InviteSignup>();

export function withInviteSignup<T>(invite: InviteSignup, fn: () => Promise<T>): Promise<T> {
  return store.run(invite, fn);
}

/** The invite covering a sign-up for `email`, or null outside an invite sign-up. */
export function inviteSignupFor(email: string): InviteSignup | null {
  const invite = store.getStore();
  if (!invite || normalizeEmail(invite.email) !== normalizeEmail(email)) return null;
  return invite;
}
