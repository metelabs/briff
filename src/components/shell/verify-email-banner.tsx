"use client";

import { MailCheck } from "lucide-react";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

import { resendVerificationAction } from "./actions";

/** Non-blocking: shown on every shell page and onboarding until the account email is verified. */
export function VerifyEmailBanner({ email }: { email: string }) {
  const [pending, start] = useTransition();
  const toast = useToast();
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
      </div>
      <Button
        variant="secondary"
        size="sm"
        className="self-center"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await resendVerificationAction();
            if (res.message) toast(res.message, res.ok ? "ok" : "error");
          })
        }
      >
        Resend verification email
      </Button>
    </aside>
  );
}
