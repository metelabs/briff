"use client";

import { MailCheck } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { FormCallout } from "@/components/ui/callout";

import { resendVerificationAction, type ResendState } from "./actions";

/** Non-blocking: shown on every shell page and onboarding until the account email is verified. */
export function VerifyEmailBanner({ email }: { email: string }) {
  const [state, setState] = useState<ResendState>({ ok: true, message: null });
  const [pending, start] = useTransition();
  return (
    <aside
      aria-label="Email verification"
      className="bg-surface border-line rounded-card mb-5 flex flex-wrap items-start gap-x-4 gap-y-2.5 border p-4 text-[13.5px]"
    >
      <MailCheck aria-hidden className="text-upgrade mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1 basis-[260px]">
        <p className="font-medium">Verify your email address</p>
        <p className="text-fg-muted [overflow-wrap:anywhere]">
          We sent a link to {email}. Open it to keep getting bulletins and alerts: an unverified
          account stops receiving them 7 days after sign-up.
        </p>
        <FormCallout ok={state.ok} message={state.message} className="mt-2.5" />
      </div>
      <Button
        variant="secondary"
        size="sm"
        className="self-center"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setState(await resendVerificationAction());
          })
        }
      >
        Resend verification email
      </Button>
    </aside>
  );
}
