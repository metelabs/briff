"use client";

import { Check } from "lucide-react";
import { useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { signOutAction } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { ConnectRepos, useScanStatus } from "./connect";
import type { ConnectData } from "./scan-status";

export function SignOutLink() {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await signOutAction();
        })
      }
    >
      Sign out
    </Button>
  );
}

function Steps({ stream }: { stream: string | null }) {
  const step = (state: "done" | "current" | "next", n: string, label: string) => (
    <span
      className={cn(
        "inline-flex items-center gap-1.5",
        state === "current" ? "text-fg font-medium" : "text-fg-muted"
      )}
      aria-current={state === "current" ? "step" : undefined}
    >
      <i
        className={cn(
          "inline-grid size-[22px] place-items-center rounded-full border text-[12px] font-semibold not-italic",
          state === "done" && "bg-ok-soft text-ok border-transparent",
          state === "current" && "bg-brand text-on-brand border-transparent",
          state === "next" && "bg-surface border-line"
        )}
      >
        {state === "done" ? <Check aria-hidden className="size-3" /> : n}
      </i>
      {label}
    </span>
  );
  const line = <span aria-hidden className="border-line-strong w-6 border-t" />;
  return (
    <div className="rise flex flex-wrap items-center gap-1.5 text-[13px]">
      {step("done", "1", stream ? `Stream: ${stream}` : "Stream")}
      {line}
      {step("current", "2", "Connect repos")}
      {line}
      {step("next", "3", "First bulletin")}
    </div>
  );
}

export function Onboarding({
  data,
  finishAction,
}: {
  data: ConnectData;
  finishAction: () => Promise<void>;
}) {
  const status = useScanStatus(data.status);
  return (
    <>
      <Steps stream={data.stream?.name ?? null} />
      <h1 className="type-page rise mt-5 mb-2 [--i:1]">Connect your repos</h1>
      <p className="text-fg-muted rise mb-6 text-[15px] [--i:2]">
        Briff never reads your code. The GitHub App or the scanner reads only lockfiles, manifests
        and runtime files, and Briff keeps the package names, versions and runtimes in them.
      </p>
      <ConnectRepos
        stream={data.stream}
        apiUrl={data.apiUrl}
        status={status}
        initialTokens={data.tokens}
        github={data.github}
      />
      <form
        action={finishAction}
        className="mt-5 flex flex-wrap items-center justify-between gap-2.5"
      >
        <FinishButton variant="ghost">Skip for now</FinishButton>
        <FinishButton variant="primary" disabled={status.included === 0}>
          Continue
        </FinishButton>
      </form>
      <p className="text-fg-muted mt-[18px] text-center text-[12.5px]">
        Your first bulletin arrives Monday 04:00 UTC once a stream has repos. Connect more repos
        later from Connect repos in the top bar.
      </p>
    </>
  );
}

function FinishButton({
  variant,
  disabled = false,
  children,
}: {
  variant: "ghost" | "primary";
  disabled?: boolean;
  children: ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={disabled || pending}>
      {children}
    </Button>
  );
}
