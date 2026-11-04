"use client";

import { Clock, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { BillingInterval, PaidPlanId } from "@/lib/billing/catalog";
import { SUPPORT_EMAIL } from "@/lib/legal";
import { PLANS } from "@/lib/plans";
import { scrollToElement } from "@/lib/scroll";

import { checkoutStatusAction } from "../actions";
import { upgradedHref, waitForSubscription } from "./wait";

/**
 * Stands where Paddle's checkout was after `checkout.completed`, inline and overlay alike:
 * one calm panel while the webhook lands, then a single navigation to Billing. Past the
 * timeout it says the payment went through and Paddle has not confirmed yet; never a failure.
 */
export function CheckoutWait({
  plan,
  interval,
  amount,
}: {
  plan: PaidPlanId;
  interval: BillingInterval;
  /** What Paddle charged, formatted; the list price when Paddle did not say. */
  amount: string;
}) {
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // On a phone the frame was taller than this panel: bring the panel back into view.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < 0 || rect.top > window.innerHeight * 0.6) void scrollToElement(el);
  }, []);

  useEffect(() => {
    let active = true;
    void waitForSubscription({
      check: () => checkoutStatusAction(),
      sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
      now: () => Date.now(),
      isActive: () => active,
    }).then((result) => {
      if (!result) return;
      if (result.phase === "ready") router.replace(upgradedHref(result.plan));
      else setTimedOut(true);
    });
    return () => {
      active = false;
    };
  }, [router]);

  const terms = `${PLANS[plan].name}, ${interval === "year" ? "yearly" : "monthly"} · ${amount}`;
  if (timedOut) {
    return (
      <div
        ref={root}
        role="status"
        className="grid min-h-[320px] place-items-center p-2 text-center"
      >
        <div className="max-w-[44ch]">
          <Clock aria-hidden className="text-fg-muted mx-auto size-6" />
          <h2 className="type-h3 mt-3">Still waiting for Paddle&apos;s confirmation</h2>
          <p className="text-fg-muted mt-1 text-[13px] tabular-nums">{terms}</p>
          <p className="text-fg-muted mt-3 text-[13.5px]">
            Your card was charged once; the plan appears as soon as Paddle confirms. Reload later or
            contact{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="text-brand underline-offset-4 hover:underline"
            >
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
          {/* A document load: in overlay mode this panel already is the Billing page. */}
          <a
            href="/settings/billing"
            className="text-brand mt-4 inline-block text-[13.5px] underline-offset-4 hover:underline"
          >
            Back to Billing
          </a>
        </div>
      </div>
    );
  }
  return (
    <div
      ref={root}
      role="status"
      aria-live="polite"
      className="grid min-h-[320px] place-items-center p-2 text-center"
    >
      <div className="max-w-[44ch]">
        <LoaderCircle
          aria-hidden
          className="text-brand mx-auto size-6 animate-spin motion-reduce:animate-none"
        />
        <h2 className="type-h3 mt-3">Setting up your subscription…</h2>
        <p className="text-fg-muted mt-1 text-[13px] tabular-nums">{terms}</p>
        <p className="text-fg-muted mt-3 text-[13.5px]">
          This takes a few seconds; you can leave this page, your plan updates on its own.
        </p>
      </div>
    </div>
  );
}
