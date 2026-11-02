import { initializePaddle, type Paddle, type PaddleEventData } from "@paddle/paddle-js";

import type { BillingInterval, PaddleEnv, PaidPlanId } from "@/lib/billing/catalog";

// Paddle.js in the browser, shared by the overlay (billing page) and the inline frame
// (checkout page). Paddle.js refuses a second initializePaddle, so the instance is one per page.

let instance: Promise<Paddle | undefined> | null = null;
let listener: ((event: PaddleEventData) => void) | null = null;

/** Paddle.js with the client token; `onEvent` replaces the previous page's listener. */
export function loadPaddle(
  config: { env: PaddleEnv; clientToken: string },
  onEvent: (event: PaddleEventData) => void
): Promise<Paddle | undefined> {
  listener = onEvent;
  instance ??= initializePaddle({
    token: config.clientToken,
    environment: config.env === "live" ? "production" : "sandbox",
    eventCallback: (event) => listener?.(event),
  });
  return instance;
}

/** The app's theme for Paddle's frame: the account menu's choice, else the system's. */
export function paddleTheme(): "light" | "dark" {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function checkoutHref(plan: PaidPlanId, interval: BillingInterval): string {
  return `/settings/billing/checkout?plan=${plan}&interval=${interval}`;
}
