"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormStatus, Label } from "@/components/ui/label";

import { type AuthFormState, signInAction, signUpAction } from "./actions";
import { type AuthMode, initialSignup, signupFooter } from "./signup-state";

const INITIAL: AuthFormState = { error: null };

interface AuthFormProps {
  mode: AuthMode;
  allowSignup: boolean;
  signup?: boolean;
}

export function AuthForm({ mode, allowSignup, signup = false }: AuthFormProps) {
  const [signingUp, setSigningUp] = useState(initialSignup(mode, allowSignup, signup));
  const [signInState, signIn, signInPending] = useActionState(signInAction, INITIAL);
  const [signUpState, signUp, signUpPending] = useActionState(signUpAction, INITIAL);

  const state = signingUp ? signUpState : signInState;
  const footer = signupFooter(mode, allowSignup);
  const pending = signingUp ? signUpPending : signInPending;
  const title =
    mode === "bootstrap" ? "Set up Briff" : signingUp ? "Create your account" : "Sign in to Briff";
  const lead =
    mode === "bootstrap"
      ? "Create the first account. It owns this instance."
      : "A weekly bulletin built from your own stack: what to fix, what to know, and nothing else.";

  return (
    <>
      <h1 className="type-page rise mb-2 [font-size:clamp(28px,6vw,36px)]">{title}</h1>
      <p className="text-fg-muted rise mb-6 text-[15px] [--i:1]">{lead}</p>
      <form
        action={signingUp ? signUp : signIn}
        className="rise flex flex-col gap-4 [--i:2]"
        // Switching modes swaps the action; remount so the fields start clean.
        key={signingUp ? "sign-up" : "sign-in"}
      >
        {signingUp && (
          <div className="grid gap-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" autoComplete="name" required />
          </div>
        )}
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
        <div className="grid gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor="password">Password</Label>
            {!signingUp && (
              <Link
                href="/forgot-password"
                className="text-brand rounded-[4px] text-[12.5px] font-medium underline-offset-4 hover:underline"
              >
                Forgot password?
              </Link>
            )}
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={signingUp ? "new-password" : "current-password"}
            minLength={signingUp ? 12 : undefined}
            required
          />
          {signingUp && <p className="text-fg-muted text-[12.5px]">At least 12 characters.</p>}
        </div>
        <FormStatus ok={false} message={state.error} />
        <Button type="submit" variant="primary" size="lg" disabled={pending} className="w-full">
          {signingUp ? "Create account" : "Sign in"}
        </Button>
      </form>
      {footer === "toggle" && (
        <p className="text-fg-muted mt-[18px] text-center text-[12.5px]">
          {signingUp ? "Already have an account? " : "New here? "}
          <button
            type="button"
            onClick={() => setSigningUp((v) => !v)}
            className="text-brand rounded-[4px] font-medium underline-offset-4 hover:underline"
          >
            {signingUp ? "Sign in" : "Create an account"}
          </button>
        </p>
      )}
      {footer === "closed" && (
        <p className="text-fg-muted mt-[18px] text-center text-[12.5px]">
          Sign-ups are closed on this instance. To get an account, ask the operator who runs it.
        </p>
      )}
    </>
  );
}
