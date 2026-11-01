"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormStatus, Label } from "@/components/ui/label";

import { requestPasswordResetAction, type ResetRequestState } from "../login/actions";

const INITIAL: ResetRequestState = { sent: false, message: null };

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordResetAction, INITIAL);
  return (
    <>
      <h1 className="type-page rise mb-2 [font-size:clamp(28px,6vw,36px)]">Reset your password</h1>
      <p className="text-fg-muted rise mb-6 text-[15px] [--i:1]">
        Enter the email you sign in with. We send a link that lets you choose a new password; it
        works for one hour.
      </p>
      <form action={action} className="rise flex flex-col gap-4 [--i:2]">
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@studio.dev"
            required
          />
        </div>
        <FormStatus ok={state.sent} message={state.message} />
        <Button type="submit" variant="primary" size="lg" disabled={pending} className="w-full">
          Send reset link
        </Button>
      </form>
      <p className="text-fg-muted mt-[18px] text-center text-[12.5px]">
        Remembered it?{" "}
        <Link
          href="/login"
          className="text-brand rounded-[4px] font-medium underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </>
  );
}
