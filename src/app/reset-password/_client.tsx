"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { FormCallout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { FieldHelp, Label } from "@/components/ui/label";

import { type AuthFormState, resetPasswordAction } from "../login/actions";

const INITIAL: AuthFormState = { error: null };

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, INITIAL);
  return (
    <>
      <h1 className="type-page rise mb-2 [font-size:clamp(28px,6vw,36px)]">
        Choose a new password
      </h1>
      <p className="text-fg-muted rise mb-6 text-[15px] [--i:1]">
        Every device signed in to your account is signed out once it is saved.
      </p>
      <form action={action} className="rise flex flex-col gap-4 [--i:2]">
        <input type="hidden" name="token" value={token} />
        <div className="grid gap-1.5">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
          />
          <FieldHelp>At least 12 characters.</FieldHelp>
        </div>
        <FormCallout ok={false} message={state.error} />
        <Button type="submit" variant="primary" size="lg" disabled={pending} className="w-full">
          Save new password
        </Button>
      </form>
    </>
  );
}
