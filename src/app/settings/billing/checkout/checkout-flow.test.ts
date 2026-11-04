import type { CheckoutEventsData, CheckoutOpenOptions } from "@paddle/paddle-js";
import { describe, expect, it } from "vitest";

import { lastPaid } from "@/lib/billing/labels";

import { chargedAmount, LOAD_FAILED, startInlineCheckout, type InlineCheckoutDeps } from "./flow";

const SESSION = {
  priceId: "pri_pro_month",
  customer: { email: "o@example.com" },
  customData: { orgId: "org-1", orgSig: "sig" },
};

function deps(over: Partial<InlineCheckoutDeps> = {}) {
  const opened: CheckoutOpenOptions[] = [];
  let loads = 0;
  const d: InlineCheckoutDeps = {
    start: async () => ({ ok: true, session: SESSION }),
    load: async () => (loads++, { Checkout: { open: (o) => void opened.push(o) } }),
    noFrame: false,
    theme: "dark",
    isActive: () => true,
    ...over,
  };
  return { d, opened, loads: () => loads };
}

describe("startInlineCheckout", () => {
  it("opens Paddle's inline frame with the server's session and the app theme", async () => {
    const { d, opened } = deps();
    expect(await startInlineCheckout(d)).toBeNull();
    expect(opened).toEqual([
      {
        items: [{ priceId: "pri_pro_month", quantity: 1 }],
        customer: { email: "o@example.com" },
        customData: { orgId: "org-1", orgSig: "sig" },
        settings: expect.objectContaining({
          displayMode: "inline",
          theme: "dark",
          frameTarget: "paddle-checkout-frame",
          frameInitialHeight: 450,
          allowLogout: false,
        }),
      },
    ]);
  });

  it("shows the server's refusal and never loads Paddle.js", async () => {
    const { d, opened, loads } = deps({
      start: async () => ({ ok: false, message: "This organisation already has that plan." }),
    });
    expect(await startInlineCheckout(d)).toBe("This organisation already has that plan.");
    expect(loads()).toBe(0);
    expect(opened).toEqual([]);
  });

  it("stops after the server's check without a client token", async () => {
    const { d, loads } = deps({ noFrame: true });
    expect(await startInlineCheckout(d)).toBeNull();
    expect(loads()).toBe(0);
  });

  it("reports a Paddle.js that fails to load or resolves to nothing", async () => {
    const failing = deps({
      load: async () => {
        throw new Error("script blocked");
      },
    });
    expect(await startInlineCheckout(failing.d)).toBe(LOAD_FAILED);
    const empty = deps({ load: async () => undefined });
    expect(await startInlineCheckout(empty.d)).toBe(LOAD_FAILED);
    const action = deps({
      start: async () => {
        throw new Error("network");
      },
    });
    expect(await startInlineCheckout(action.d)).toBe(LOAD_FAILED);
  });

  it("does nothing once the page is gone", async () => {
    let active = true;
    const { d, opened } = deps({
      start: async () => ((active = false), { ok: true, session: SESSION }),
      isActive: () => active,
    });
    expect(await startInlineCheckout(d)).toBeNull();
    expect(opened).toEqual([]);
  });

  it("leaves the redirect to the page: Paddle gets no successUrl", async () => {
    const { d, opened } = deps();
    await startInlineCheckout(d);
    expect(opened[0].settings).not.toHaveProperty("successUrl");
  });
});

describe("chargedAmount", () => {
  it("shows what Paddle charged, else the plan's list price", () => {
    const data = { totals: { total: 4.8 }, currency_code: "EUR" } as CheckoutEventsData;
    expect(chargedAmount(data, { plan: "pro", interval: "month" })).toBe("€4.80");
    expect(chargedAmount(undefined, { plan: "pro", interval: "month" })).toBe("$4");
    expect(chargedAmount(undefined, { plan: "team", interval: "year" })).toBe("$120");
  });
});

describe("lastPaid", () => {
  it("skips a failed renewal for the last payment", () => {
    expect(
      lastPaid([
        { id: "t3", status: "past_due" },
        { id: "t2", status: "completed" },
      ])?.id
    ).toBe("t2");
    expect(lastPaid([{ id: "t1", status: "canceled" }])).toBeUndefined();
  });
});
