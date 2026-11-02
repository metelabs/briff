import "server-only";

import { Environment, LogLevel, Paddle } from "@paddle/paddle-node-sdk";

import { getEnv } from "@/lib/env";

import { fakeBillingApi } from "./fake-api";
import { summariseMethod, type PaymentMethodSummary } from "./payment-method";
import { formatMoney, type PaddleSubscriptionLike } from "./state";
import type { ProrationBillingMode } from "@paddle/paddle-node-sdk";

// The Paddle API calls the app makes, behind one narrow interface: the Server Actions, the
// billing page and billing-check depend on this, never on the SDK, so tests and the
// development fake swap it. Shapes follow @paddle/paddle-node-sdk (docs/BILLING.md).

export interface BillingPreview {
  /** Charged now (formatted, tax included); null when nothing is charged now. */
  dueNow: string | null;
  /** Credited now for unused time (formatted); null without a credit. */
  credit: string | null;
  /** The new recurring amount (formatted). */
  recurring: string | null;
  nextBilledAt: Date | null;
}

export interface BillingTransaction {
  id: string;
  /** billedAt, else createdAt. */
  date: Date;
  status: string;
  total: string;
  invoiceNumber: string | null;
}

export interface TransactionOwner {
  customerId: string | null;
  subscriptionId: string | null;
}

export interface BillingApi {
  getSubscription(subscriptionId: string): Promise<PaddleSubscriptionLike>;
  previewPriceChange(
    subscriptionId: string,
    priceId: string,
    mode: ProrationBillingMode
  ): Promise<BillingPreview>;
  /** The writes return the subscription as Paddle holds it afterwards (null from the fake). */
  changePrice(
    subscriptionId: string,
    priceId: string,
    mode: ProrationBillingMode
  ): Promise<PaddleSubscriptionLike | null>;
  cancelAtPeriodEnd(subscriptionId: string): Promise<PaddleSubscriptionLike | null>;
  cancelNow(subscriptionId: string): Promise<PaddleSubscriptionLike | null>;
  /** Drops a scheduled cancel ("Resume"). */
  removeScheduledChange(subscriptionId: string): Promise<PaddleSubscriptionLike | null>;
  customerEmail(customerId: string): Promise<string>;
  /** A fresh, one-time customer portal URL (customer-portal skill). */
  portalUrl(customerId: string, subscriptionIds: string[]): Promise<string>;
  /** Newest first, customer-facing statuses only (billing-history skill). */
  listTransactions(
    customerId: string,
    subscriptionIds: string[],
    limit: number
  ): Promise<BillingTransaction[]>;
  transactionOwner(transactionId: string): Promise<TransactionOwner>;
  invoiceUrl(transactionId: string): Promise<string>;
  /**
   * The payment method that pays for these subscriptions: the one their newest payment used,
   * read fresh from the customer's saved methods (`payment_method.read`). Throws when Paddle
   * refuses (the API key lacks the permission) or does not answer.
   */
  paymentMethod(
    customerId: string,
    subscriptionIds: string[]
  ): Promise<PaymentMethodSummary | null>;
  /** The subscription's update_payment_method link from `management_urls`, if any. */
  paymentMethodUpdateUrl(subscriptionId: string): Promise<string | null>;
}

const HISTORY_STATUSES = ["billed", "paid", "past_due", "completed", "canceled"] as const;

function paddleApi(apiKey: string, env: "sandbox" | "live"): BillingApi {
  const paddle = new Paddle(apiKey, {
    environment: env === "live" ? Environment.production : Environment.sandbox,
    logLevel: LogLevel.error,
  });
  return {
    getSubscription: (id) => paddle.subscriptions.get(id),
    async previewPriceChange(id, priceId, mode) {
      const preview = await paddle.subscriptions.previewUpdate(id, {
        items: [{ priceId, quantity: 1 }],
        prorationBillingMode: mode,
      });
      const now = preview.immediateTransaction?.details.totals;
      const recurring = preview.recurringTransactionDetails?.totals;
      const total = now ? Number(now.total) : 0;
      return {
        dueNow: now && total > 0 ? formatMoney(now.total, now.currencyCode) : null,
        // A shorter period or a smaller plan prorated now comes back as a negative total.
        credit: now && total < 0 ? formatMoney(String(-total), now.currencyCode) : null,
        recurring: recurring ? formatMoney(recurring.total, recurring.currencyCode) : null,
        nextBilledAt: preview.nextBilledAt ? new Date(preview.nextBilledAt) : null,
      };
    },
    changePrice(id, priceId, mode) {
      // items replaces the subscription's items; onPaymentFailure stays prevent_change.
      return paddle.subscriptions.update(id, {
        items: [{ priceId, quantity: 1 }],
        prorationBillingMode: mode,
      });
    },
    cancelAtPeriodEnd: (id) =>
      paddle.subscriptions.cancel(id, { effectiveFrom: "next_billing_period" }),
    cancelNow: (id) => paddle.subscriptions.cancel(id, { effectiveFrom: "immediately" }),
    removeScheduledChange: (id) => paddle.subscriptions.update(id, { scheduledChange: null }),
    async customerEmail(customerId) {
      return (await paddle.customers.get(customerId)).email;
    },
    async portalUrl(customerId, subscriptionIds) {
      const session = await paddle.customerPortalSessions.create(customerId, subscriptionIds);
      return session.urls.general.overview;
    },
    async listTransactions(customerId, subscriptionIds, limit) {
      if (subscriptionIds.length === 0) return [];
      const page = await paddle.transactions
        .list({
          customerId: [customerId],
          subscriptionId: subscriptionIds,
          status: [...HISTORY_STATUSES],
          orderBy: "created_at[DESC]",
          perPage: limit,
        })
        .next();
      return page.slice(0, limit).map((t) => ({
        id: t.id,
        date: new Date(t.billedAt ?? t.createdAt),
        status: t.status,
        total: formatMoney(t.details?.totals?.total, t.currencyCode),
        invoiceNumber: t.invoiceNumber,
      }));
    },
    async transactionOwner(id) {
      const t = await paddle.transactions.get(id);
      return { customerId: t.customerId, subscriptionId: t.subscriptionId };
    },
    async invoiceUrl(id) {
      return (await paddle.transactions.getInvoicePDF(id)).url;
    },
    async paymentMethod(customerId, subscriptionIds) {
      if (subscriptionIds.length === 0) return null;
      const [saved, recent] = await Promise.all([
        paddle.paymentMethods.list(customerId).next(),
        paddle.transactions
          .list({
            customerId: [customerId],
            subscriptionId: subscriptionIds,
            status: ["completed", "paid", "billed", "past_due"],
            orderBy: "created_at[DESC]",
            perPage: 10,
          })
          .next(),
      ]);
      const used = recent
        .flatMap((t) => t.payments ?? [])
        .find((p) => p.status === "captured" && (p.paymentMethodId || p.storedPaymentMethodId));
      const id = used?.paymentMethodId ?? used?.storedPaymentMethodId ?? null;
      // Only the method this org's own payment used: the customer may pay for other orgs too.
      const match = id ? saved.find((m) => m.id === id) : undefined;
      if (match) return summariseMethod(match);
      // A method that is no longer saved still names what paid last.
      return used?.methodDetails ? summariseMethod(used.methodDetails) : null;
    },
    async paymentMethodUpdateUrl(id) {
      return (await paddle.subscriptions.get(id)).managementUrls?.updatePaymentMethod ?? null;
    },
  };
}

let override: BillingApi | null | undefined;

/** Test hook: the API every caller gets until reset (undefined = from env again). */
export function setBillingApiForTests(api: BillingApi | null | undefined): void {
  override = api;
}

/** The Paddle API for this instance, the development fake, or null without an API key. */
export function getBillingApi(): BillingApi | null {
  if (override !== undefined) return override;
  const env = getEnv();
  if (env.BRIFF_PADDLE_FAKE && env.NODE_ENV !== "production") return fakeBillingApi();
  if (!env.PADDLE_API_KEY) return null;
  return paddleApi(env.PADDLE_API_KEY, env.PADDLE_ENV);
}
