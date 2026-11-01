import { createHmac } from "node:crypto";

import { safeEqual } from "@/lib/crypto";

// Checkout passes `custom_data: { orgId, orgSig }` to Paddle, which copies it to the
// transaction and the subscription. The signature (keyed from BETTER_AUTH_SECRET) lets the
// webhook trust the org id: a buyer who edits the overlay's custom data cannot attach a
// subscription, or their Paddle customer, to an org whose billing page they never saw.

const PURPOSE = "briff:billing-org:v1";

function sign(secret: string, orgId: string): string {
  const key = createHmac("sha256", secret).update(PURPOSE).digest();
  return createHmac("sha256", key).update(orgId).digest("base64url");
}

export interface CheckoutCustomData {
  orgId: string;
  orgSig: string;
}

export function checkoutCustomData(secret: string, orgId: string): CheckoutCustomData {
  return { orgId, orgSig: sign(secret, orgId) };
}

/** The org id from custom data when its signature is valid, else null. */
export function signedOrgId(secret: string, customData: unknown): string | null {
  if (typeof customData !== "object" || customData === null) return null;
  const { orgId, orgSig } = customData as Record<string, unknown>;
  if (typeof orgId !== "string" || typeof orgSig !== "string" || !orgId) return null;
  return safeEqual(sign(secret, orgId), orgSig) ? orgId : null;
}
