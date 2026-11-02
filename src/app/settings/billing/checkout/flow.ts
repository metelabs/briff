import type { CheckoutOpenOptions, Theme } from "@paddle/paddle-js";

import type { CheckoutSession, ManageResult } from "@/lib/billing/manage";

// The inline checkout's start-up, apart from React so every path is tested
// (checkout-flow.test.ts): ask the server for the session, load Paddle.js, open the frame.

export const FRAME_CLASS = "paddle-checkout-frame";
export const LOAD_FAILED = "Paddle checkout did not load. Reload the page and try again.";

export interface InlineCheckoutDeps {
  start: () => Promise<ManageResult<{ session: CheckoutSession }>>;
  load: () => Promise<{ Checkout: { open: (options: CheckoutOpenOptions) => void } } | undefined>;
  /** No client token (BRIFF_PADDLE_FAKE): stop after the server's check, show a placeholder. */
  noFrame: boolean;
  theme: Theme;
  origin: string;
  /** False once the page unmounted: nothing is opened or reported after that. */
  isActive: () => boolean;
}

/** Opens Paddle's inline frame; returns the message to show, or null when nothing failed. */
export async function startInlineCheckout(deps: InlineCheckoutDeps): Promise<string | null> {
  try {
    const res = await deps.start();
    if (!deps.isActive()) return null;
    if (!res.ok) return res.message;
    if (deps.noFrame) return null;
    const paddle = await deps.load();
    if (!deps.isActive()) return null;
    if (!paddle) return LOAD_FAILED;
    paddle.Checkout.open({
      items: [{ priceId: res.session.priceId, quantity: 1 }],
      customer: res.session.customer,
      customData: { ...res.session.customData },
      settings: {
        displayMode: "inline",
        variant: "one-page",
        theme: deps.theme,
        allowLogout: false,
        frameTarget: FRAME_CLASS,
        frameInitialHeight: 450,
        frameStyle: "width: 100%; min-width: 286px; background-color: transparent; border: none;",
        successUrl: `${deps.origin}/settings/billing?checkout=success`,
      },
    });
    return null;
  } catch {
    return deps.isActive() ? LOAD_FAILED : null;
  }
}
