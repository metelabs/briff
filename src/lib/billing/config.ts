import "server-only";

import { getEnv, isBillingConfigured } from "@/lib/env";

import { catalogComplete, type PaddleEnv } from "./catalog";

export interface BillingConfig {
  env: PaddleEnv;
  /** Paddle.js client token (public); empty with the development fake. */
  clientToken: string;
  /** BRIFF_PADDLE_FAKE: canned API answers, no Paddle.js. */
  fake: boolean;
}

/**
 * Checkout and plan management on this instance, or null: billing exists only on the hosted
 * service, with the API key and the client token, and with price ids for PADDLE_ENV.
 */
export function billingConfig(): BillingConfig | null {
  if (!isBillingConfigured()) return null;
  const env = getEnv();
  if (!catalogComplete(env.PADDLE_ENV)) return null;
  const fake = env.BRIFF_PADDLE_FAKE && env.NODE_ENV !== "production";
  return { env: env.PADDLE_ENV, clientToken: fake ? "" : (env.PADDLE_CLIENT_TOKEN ?? ""), fake };
}
