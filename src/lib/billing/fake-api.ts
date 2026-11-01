import type { BillingApi, BillingTransaction } from "./api";

// BRIFF_PADDLE_FAKE (development only, refused in production): canned answers so the billing
// page, the change-plan preview and billing history render without a Paddle API key. It
// changes nothing anywhere; plan changes still only arrive through webhooks.

const DAY = 86_400_000;

function history(now: number): BillingTransaction[] {
  return [0, 1, 2].map((i) => ({
    id: `txn_fake_${i}`,
    date: new Date(now - i * 30 * DAY),
    status: "completed",
    total: "$12.00",
    invoiceNumber: `325-${10_420 - i}`,
  }));
}

export function fakeBillingApi(): BillingApi {
  const fail = async (): Promise<never> => {
    throw new Error("BRIFF_PADDLE_FAKE: this call needs the real Paddle API");
  };
  return {
    getSubscription: fail,
    async previewPriceChange() {
      return {
        dueNow: "$22.40",
        recurring: "$39.00",
        nextBilledAt: new Date(Date.now() + 18 * DAY),
      };
    },
    async changePrice() {
      return null;
    },
    async cancelAtPeriodEnd() {
      return null;
    },
    cancelNow: fail,
    async removeScheduledChange() {
      return null;
    },
    async customerEmail() {
      return "";
    },
    async portalUrl() {
      return "https://sandbox-customer-portal.paddle.com/";
    },
    async listTransactions(_customer, _subs, limit) {
      return history(Date.now()).slice(0, limit);
    },
    async transactionOwner() {
      return { customerId: null, subscriptionId: null };
    },
    async invoiceUrl() {
      return "https://sandbox-vendors.paddle.com/";
    },
  };
}
