import { describe, expect, it } from "vitest";

import {
  chargeSentence,
  expiryLabel,
  isExpired,
  methodLabel,
  summariseMethod,
} from "./payment-method";

const VISA = summariseMethod({
  type: "card",
  card: { type: "visa", last4: "4242", expiryMonth: 1, expiryYear: 2027 },
  paypal: null,
});

describe("payment method summary", () => {
  it("labels cards, wallets and PayPal", () => {
    expect(VISA.brand).toBe("visa");
    expect(methodLabel(VISA)).toBe("Visa\u00a0••••\u00a04242");
    expect(expiryLabel(VISA)).toBe("Expires 01/2027");
    const apple = summariseMethod({
      type: "apple_pay",
      card: { type: "mastercard", last4: "5100", expiryMonth: 12, expiryYear: 2028 },
      paypal: null,
    });
    expect(apple.brand).toBe("apple_pay");
    expect(methodLabel(apple)).toBe("Apple Pay · Mastercard\u00a0••••\u00a05100");
    const paypal = summariseMethod({ type: "paypal", card: null, paypal: { email: "a@b.c" } });
    expect(paypal.brand).toBe("paypal");
    expect(methodLabel(paypal)).toBe("PayPal");
    expect(expiryLabel(paypal)).toBeNull();
    const jcb = summariseMethod({
      type: "card",
      card: { type: "jcb", last4: "0000", expiryMonth: 3, expiryYear: 2030 },
      paypal: null,
    });
    expect(jcb.brand).toBe("other");
    expect(methodLabel(jcb)).toBe("JCB\u00a0••••\u00a00000");
  });

  it("knows when a card has expired", () => {
    expect(isExpired(VISA, new Date("2027-01-31T00:00:00Z"))).toBe(false);
    expect(isExpired(VISA, new Date("2027-02-01T00:00:00Z"))).toBe(true);
  });
});

describe("chargeSentence", () => {
  it("says what is charged now, with what, and what follows", () => {
    expect(
      chargeSentence(
        {
          billing: "now",
          dueNow: "$108.00",
          credit: null,
          recurring: "$120.00",
          interval: "year",
          nextBilledAt: "2027-11-02T09:24:19Z",
        },
        "Visa\u00a0••••\u00a04242"
      )
    ).toBe(
      "You pay $108.00 now with Visa\u00a0••••\u00a04242, then $120.00 per year from 2 November 2027."
    );
  });

  it("falls back to the saved payment method when the card is unknown", () => {
    expect(
      chargeSentence(
        {
          billing: "next-bill",
          dueNow: null,
          credit: null,
          recurring: "$4.00",
          interval: "month",
          nextBilledAt: "2026-12-02T00:00:00Z",
        },
        null
      )
    ).toBe(
      "Nothing is charged now. You pay $4.00 per month from 2 December 2026, with your saved payment method."
    );
  });

  it("explains a credit for unused time", () => {
    expect(
      chargeSentence(
        {
          billing: "now",
          dueNow: null,
          credit: "$116.29",
          recurring: "$4.00",
          interval: "month",
          nextBilledAt: "2026-12-02T00:00:00Z",
        },
        "Visa\u00a0••••\u00a04242"
      )
    ).toBe(
      "Nothing is charged now: Paddle credits $116.29 for the unused time and uses it on your next bills. Then $4.00 per month from 2 December 2026, with Visa\u00a0••••\u00a04242."
    );
  });
});
