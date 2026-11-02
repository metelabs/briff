import "server-only";

import { getEnv, isBillingConfigured } from "@/lib/env";

import type { PaddleEnv } from "./catalog";

export interface BillingConfig {
  env: PaddleEnv;
  /** Paddle.js client token (public); empty with the development fake. */
  clientToken: string;
  /** BRIFF_PADDLE_FAKE: canned API answers, no Paddle.js. */
  fake: boolean;
  /** BRIFF_CHECKOUT: Briff's checkout page with the inline frame, or Paddle's overlay. */
  checkout: "inline" | "overlay";
}

/**
 * Checkout and plan management on this instance, or null: billing exists only on the hosted
 * service, with the API key and the client token, and with price ids for PADDLE_ENV
 * (`isBillingConfigured`).
 */
export function billingConfig(): BillingConfig | null {
  if (!isBillingConfigured()) return null;
  const env = getEnv();
  const fake = env.BRIFF_PADDLE_FAKE && env.NODE_ENV !== "production";
  return {
    env: env.PADDLE_ENV,
    clientToken: fake ? "" : (env.PADDLE_CLIENT_TOKEN ?? ""),
    fake,
    checkout: env.BRIFF_CHECKOUT,
  };
}
