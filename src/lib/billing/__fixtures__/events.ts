import { createHmac } from "node:crypto";

import type {
  IEventsResponse,
  ISubscriptionNotificationResponse,
  ITransactionNotificationResponse,
} from "@paddle/paddle-node-sdk";

// Paddle webhook bodies in the wire shape (snake_case, @paddle/paddle-node-sdk's
// I*NotificationResponse types, as the sandbox simulator sends them), signed like Paddle:
// `Paddle-Signature: ts=<unix>;h1=<hex hmac-sha256 of "<ts>:<raw body>">`.

export const PRO_MONTHLY = "pri_01m6c6eh8vp89cnpqw7vpv2krh";
export const PRO_YEARLY = "pri_01m6c6ehdk4jnaddj3n1p21w9a";
export const TEAM_MONTHLY = "pri_01m6c6ehqacmse2ybry03yxe3h";

const PLAN_OF: Record<string, { plan: string; interval: "month" | "year" }> = {
  [PRO_MONTHLY]: { plan: "pro", interval: "month" },
  [PRO_YEARLY]: { plan: "pro", interval: "year" },
  [TEAM_MONTHLY]: { plan: "team", interval: "month" },
};

export interface SubscriptionFixture {
  id: string;
  customerId: string;
  status: ISubscriptionNotificationResponse["status"];
  priceId?: string;
  customData?: object | null;
  periodEnd?: string;
  scheduledChange?: ISubscriptionNotificationResponse["scheduled_change"];
  canceledAt?: string | null;
}

export function subscriptionData(f: SubscriptionFixture): ISubscriptionNotificationResponse {
  const priceId = f.priceId ?? PRO_MONTHLY;
  const terms = PLAN_OF[priceId] ?? { plan: "pro", interval: "month" };
  const end = f.periodEnd ?? "2026-12-02T10:00:00.000Z";
  return {
    id: f.id,
    status: f.status,
    customer_id: f.customerId,
    address_id: "add_01fixture",
    business_id: null,
    currency_code: "USD",
    created_at: "2026-11-02T10:00:00.000Z",
    updated_at: "2026-11-02T10:00:00.000Z",
    started_at: "2026-11-02T10:00:00.000Z",
    first_billed_at: "2026-11-02T10:00:00.000Z",
    next_billed_at: f.status === "canceled" ? null : end,
    paused_at: null,
    canceled_at: f.canceledAt ?? null,
    discount: null,
    collection_mode: "automatic",
    billing_details: null,
    current_billing_period:
      f.status === "canceled" ? null : { starts_at: "2026-11-02T10:00:00.000Z", ends_at: end },
    billing_cycle: { interval: terms.interval, frequency: 1 },
    scheduled_change: f.scheduledChange ?? null,
    items: [
      {
        status: "active",
        quantity: 1,
        recurring: true,
        created_at: "2026-11-02T10:00:00.000Z",
        updated_at: "2026-11-02T10:00:00.000Z",
        previously_billed_at: "2026-11-02T10:00:00.000Z",
        next_billed_at: end,
        trial_dates: null,
        price: {
          id: priceId,
          product_id:
            terms.plan === "team"
              ? "pro_01m6c6ehkgzfxmzqs9yy132zjw"
              : "pro_01m6c6eh50pw25pw4snp36m297",
          description: `Briff ${terms.plan} ${terms.interval}`,
          tax_mode: "account_setting",
          billing_cycle: { interval: terms.interval, frequency: 1 },
          quantity: { minimum: 1, maximum: 1 },
          unit_price: {
            amount: terms.plan === "team" ? "3900" : "1200",
            currency_code: "USD",
          },
          custom_data: { plan: terms.plan, interval: terms.interval },
        },
        product: {
          id:
            terms.plan === "team"
              ? "pro_01m6c6ehkgzfxmzqs9yy132zjw"
              : "pro_01m6c6eh50pw25pw4snp36m297",
          name: terms.plan === "team" ? "Briff Team" : "Briff Pro",
          tax_category: "saas",
          status: "active",
          created_at: "2026-11-01T10:00:00.000Z",
        },
      },
    ],
    custom_data: (f.customData as Record<string, unknown> | undefined) ?? null,
  };
}

export function event<T extends object>(
  type: string,
  data: T,
  opts: { id: string; occurredAt: string }
): IEventsResponse<T> {
  return {
    event_id: opts.id,
    notification_id: `ntf_${opts.id.slice(4)}`,
    event_type: type,
    occurred_at: opts.occurredAt,
    data,
  };
}

export function transactionData(f: {
  id: string;
  customerId: string;
  subscriptionId: string | null;
  customData?: object | null;
  status?: ITransactionNotificationResponse["status"];
}): ITransactionNotificationResponse {
  return {
    id: f.id,
    status: f.status ?? "completed",
    customer_id: f.customerId,
    address_id: "add_01fixture",
    business_id: null,
    custom_data: (f.customData as Record<string, unknown> | undefined) ?? null,
    currency_code: "USD",
    origin: "web",
    subscription_id: f.subscriptionId,
    invoice_id: null,
    invoice_number: null,
    collection_mode: "automatic",
    discount_id: null,
    billing_details: null,
    billing_period: null,
    items: [],
    details: null,
    payments: [],
    checkout: null,
    created_at: "2026-11-02T10:00:00.000Z",
    updated_at: "2026-11-02T10:00:00.000Z",
    billed_at: "2026-11-02T10:00:00.000Z",
  };
}

export function paddleSignature(
  secret: string,
  raw: string,
  ts = Math.floor(Date.now() / 1000)
): string {
  const h1 = createHmac("sha256", secret).update(`${ts}:${raw}`).digest("hex");
  return `ts=${ts};h1=${h1}`;
}
