import type { PaidPlanId } from "@/lib/billing/catalog";

// After Paddle's `checkout.completed` the subscription arrives through the webhook a few
// seconds later. The page polls `checkoutStatusAction` until it has, then navigates once;
// apart from React so every transition is tested (wait.test.ts).

export const WAIT_POLL_MS = 2000;
export const WAIT_FOR_MS = 60_000;

export type CheckoutStatus = { ready: true; plan: PaidPlanId } | { ready: false };
export type WaitPhase = "waiting" | "ready" | "timed-out";

/** Ready wins even on the last poll; past WAIT_FOR_MS without it the page stops asking. */
export function waitPhase(status: CheckoutStatus, elapsedMs: number): WaitPhase {
  if (status.ready) return "ready";
  return elapsedMs >= WAIT_FOR_MS ? "timed-out" : "waiting";
}

/** Billing with the one-shot "You're on Pro" flash (`src/lib/flash.ts`). */
export function upgradedHref(plan: PaidPlanId): string {
  return `/settings/billing?upgraded=${plan}`;
}

export interface WaitDeps {
  check: () => Promise<CheckoutStatus>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** False once the page unmounted: the loop stops without a result. */
  isActive: () => boolean;
}

/**
 * Polls every WAIT_POLL_MS until the subscription is there or WAIT_FOR_MS passed. A failed
 * check (network, a deploy) counts as "not yet", never as a failed payment. Null when the
 * page went away first.
 */
export async function waitForSubscription(
  deps: WaitDeps
): Promise<{ phase: "ready"; plan: PaidPlanId } | { phase: "timed-out" } | null> {
  const started = deps.now();
  for (;;) {
    const status = await deps.check().catch((): CheckoutStatus => ({ ready: false }));
    if (!deps.isActive()) return null;
    const phase = waitPhase(status, deps.now() - started);
    if (status.ready) return { phase: "ready", plan: status.plan };
    if (phase === "timed-out") return { phase };
    await deps.sleep(WAIT_POLL_MS);
    if (!deps.isActive()) return null;
  }
}
