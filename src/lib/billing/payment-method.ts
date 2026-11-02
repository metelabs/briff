// The saved payment method shown on the billing page, the plan-change confirmation and
// Settings -> Billing, and the sentence that says what a plan change charges. Pure.

export type PaymentBrand =
  "visa" | "mastercard" | "american_express" | "paypal" | "apple_pay" | "google_pay" | "other";

export interface PaymentMethodSummary {
  brand: PaymentBrand;
  /** Paddle's method type ("card", "paypal", "apple_pay", ...). */
  type: string;
  /** Card network for a card or a wallet backed by one ("visa", "mastercard", ...). */
  network: string | null;
  last4: string | null;
  expiryMonth: number | null;
  expiryYear: number | null;
  /** PayPal's account email. */
  email: string | null;
}

/** What the billing page knows about the payment method. */
export type PaymentMethodState =
  | { kind: "known"; method: PaymentMethodSummary }
  /** No saved method found for the org's subscription. */
  | { kind: "none" }
  /** The API key lacks `payment_method.read`, or Paddle did not answer. */
  | { kind: "unavailable" };

/** The fields read from Paddle's method details (transaction payment or saved method). */
export interface MethodDetailsLike {
  type: string;
  card: { type: string; last4: string; expiryMonth: number; expiryYear: number } | null;
  paypal: { email: string } | null;
}

const NETWORK_BRAND: Record<string, PaymentBrand> = {
  visa: "visa",
  mastercard: "mastercard",
  american_express: "american_express",
};

export function summariseMethod(details: MethodDetailsLike): PaymentMethodSummary {
  const network = details.card?.type ?? null;
  const brand: PaymentBrand =
    details.type === "paypal"
      ? "paypal"
      : details.type === "apple_pay"
        ? "apple_pay"
        : details.type === "google_pay"
          ? "google_pay"
          : ((network ? NETWORK_BRAND[network] : undefined) ?? "other");
  return {
    brand,
    type: details.type,
    network,
    last4: details.card?.last4 ?? null,
    expiryMonth: details.card?.expiryMonth ?? null,
    expiryYear: details.card?.expiryYear ?? null,
    email: details.paypal?.email ?? null,
  };
}

const NETWORK_NAME: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  american_express: "Amex",
  diners_club: "Diners Club",
  discover: "Discover",
  jcb: "JCB",
  maestro: "Maestro",
  union_pay: "UnionPay",
  mada: "mada",
};

const TYPE_NAME: Record<string, string> = {
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  paypal: "PayPal",
  card: "Card",
};

// Non-breaking spaces keep "Visa •••• 4242" on one line inside a sentence.
const NB = "\u00a0";

/** "Visa •••• 4242", "Apple Pay · Visa •••• 4242", "PayPal". */
export function methodLabel(m: PaymentMethodSummary): string {
  const card = m.last4
    ? `${(m.network ? NETWORK_NAME[m.network] : undefined) ?? "Card"}${NB}••••${NB}${m.last4}`
    : null;
  if (m.type === "card") return card ?? "Card";
  const name = TYPE_NAME[m.type] ?? "Saved payment method";
  return card ? `${name} · ${card}` : name;
}

/** "Expires 01/2027"; null without a card expiry. */
export function expiryLabel(m: PaymentMethodSummary): string | null {
  if (!m.expiryMonth || !m.expiryYear) return null;
  return `Expires ${String(m.expiryMonth).padStart(2, "0")}/${m.expiryYear}`;
}

/** True once the card's expiry month is over. */
export function isExpired(m: PaymentMethodSummary, now: Date): boolean {
  if (!m.expiryMonth || !m.expiryYear) return false;
  const y = now.getUTCFullYear();
  const mo = now.getUTCMonth() + 1;
  return m.expiryYear < y || (m.expiryYear === y && m.expiryMonth < mo);
}

export interface ChargeTerms {
  /** "now": the prorated difference is charged today; "next-bill": settled on the next bill. */
  billing: "now" | "next-bill";
  dueNow: string | null;
  /** A credit for unused time (a shorter period or a smaller plan prorated now). */
  credit: string | null;
  recurring: string | null;
  interval: "month" | "year";
  nextBilledAt: string | null;
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * "You pay $27.00 now with Visa •••• 4242, then $390.00 per year from 2 November 2027."
 * Paddle charges a plan change to the saved payment method without a card prompt, so the
 * confirmation names the amount and the method.
 */
export function chargeSentence(terms: ChargeTerms, method: string | null): string {
  const with_ = method ? `with ${method}` : "with your saved payment method";
  const then = terms.recurring
    ? `${terms.recurring} per ${terms.interval}${terms.nextBilledAt ? ` from ${day(terms.nextBilledAt)}` : ""}`
    : null;
  if (terms.billing === "now" && terms.dueNow) {
    return `You pay ${terms.dueNow} now ${with_}${then ? `, then ${then}` : ""}.`;
  }
  if (terms.credit) {
    return `Nothing is charged now: Paddle credits ${terms.credit} for the unused time and uses it on your next bills. Then ${then ?? "the new price"}, ${with_}.`;
  }
  return then
    ? `Nothing is charged now. You pay ${then}, ${with_}.`
    : `Nothing is charged now; the difference is settled on your next bill, ${with_}.`;
}
