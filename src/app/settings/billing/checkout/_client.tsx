"use client";

import type { CheckoutEventsData } from "@paddle/paddle-js";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Callout } from "@/components/ui/callout";
import type { BillingInterval, PaddleEnv, PaidPlanId } from "@/lib/billing/catalog";

import { startCheckoutAction } from "../actions";
import { loadPaddle, paddleTheme } from "../paddle";
import { FRAME_CLASS, startInlineCheckout } from "./flow";

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

/**
 * Paddle's inline checkout. The price, the customer and the signed org id come from
 * `startCheckoutAction` (which refuses a plan the org already has); Paddle.js then renders
 * its frame into FRAME_CLASS. Without a client token (BRIFF_PADDLE_FAKE) a placeholder
 * stands where the frame would be.
 */
export function InlineCheckout({
  config,
  terms,
}: {
  config: { env: PaddleEnv; clientToken: string; fake: boolean };
  terms: { plan: PaidPlanId; interval: BillingInterval };
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [totals, setTotals] = useState<CheckoutEventsData | null>(null);
  const opened = useRef(false);
  const noFrame = config.fake || !config.clientToken;

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    let active = true;
    void startInlineCheckout({
      start: () => startCheckoutAction(terms),
      load: () =>
        loadPaddle(config, (event) => {
          if (event.name === "checkout.loaded") setLoaded(true);
          if (event.data) setTotals(event.data);
          if (event.name === "checkout.completed") {
            router.push("/settings/billing?checkout=success");
          }
        }),
      noFrame,
      theme: paddleTheme(),
      origin: window.location.origin,
      isActive: () => active,
    }).then((message) => {
      if (message) setError(message);
    });
    return () => {
      active = false;
      opened.current = false;
    };
  }, [config, terms, noFrame, router]);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="type-h2">Payment</h2>
        {totals && (
          <span className="text-fg-muted text-[13px] tabular-nums">
            Due today{" "}
            <b className="text-fg font-medium">
              {money(totals.totals.total, totals.currency_code)}
            </b>
            {totals.totals.tax > 0 &&
              ` incl. ${money(totals.totals.tax, totals.currency_code)} tax`}
          </span>
        )}
      </div>
      {error && <Callout tone="warn" className="mt-4" message={error} />}
      {!error && noFrame && (
        <div className="bg-surface-2 border-line rounded-inset text-fg-muted mt-4 grid min-h-[420px] place-items-center border border-dashed p-6 text-center text-[13.5px]">
          <p className="max-w-[36ch]">
            Paddle&apos;s secure payment form loads here. It needs a Paddle client token
            (BRIFF_PADDLE_FAKE is on).
          </p>
        </div>
      )}
      {!error && !noFrame && !loaded && (
        <div className="bg-surface-2 rounded-inset mt-4 h-[420px]" aria-hidden />
      )}
      <div className={`${FRAME_CLASS} mt-2`} />
    </div>
  );
}
