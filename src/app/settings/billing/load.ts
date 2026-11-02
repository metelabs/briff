import "server-only";

import { cache } from "react";

import { getBillingApi } from "@/lib/billing/api";
import { billingHistory, paymentMethodState } from "@/lib/billing/manage";
import type { PaymentMethodState } from "@/lib/billing/payment-method";
import { getDb } from "@/lib/db/client";

// Paddle reads for one request, shared by the sections that show them (the billing page's
// cards, Settings -> Billing). Cached per request only: a card or payment changed in Paddle
// shows on the next page load.

export const loadPaymentMethod = cache(async (orgId: string): Promise<PaymentMethodState> => {
  const api = getBillingApi();
  if (!api) return { kind: "unavailable" };
  return paymentMethodState(getDb(), api, orgId);
});

export const loadHistory = cache(async (orgId: string) => {
  const api = getBillingApi();
  if (!api) return [];
  return billingHistory(getDb(), api, orgId);
});
