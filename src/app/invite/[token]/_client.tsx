"use client";

import { useActionState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { useResultToast } from "@/components/ui/toast";

import { joinInviteAction, type JoinState, signOutForInviteAction } from "./actions";

const INITIAL: JoinState = { ok: true, message: null };

export function JoinButton({ token, orgName }: { token: string; orgName: string }) {
  const [state, action, pending] = useActionState(joinInviteAction, INITIAL);
  useResultToast(state, state);
  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} />
      <Button type="submit" variant="primary" size="lg" disabled={pending} className="w-full">
        Join {orgName}
      </Button>
    </form>
  );
}

export function SignOutForInviteButton({ token }: { token: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      size="lg"
      className="w-full"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await signOutForInviteAction(token);
        })
      }
    >
      Sign out
    </Button>
  );
}
