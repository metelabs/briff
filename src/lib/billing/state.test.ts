import { Webhooks, type SubscriptionNotification } from "@paddle/paddle-node-sdk";
import { describe, expect, it } from "vitest";

import { catalogComplete, PADDLE_CATALOG, priceFor } from "./catalog";
import { event, PRO_YEARLY, subscriptionData, TEAM_MONTHLY } from "./__fixtures__/events";
import { checkoutCustomData, signedOrgId } from "./org-link";
import {
  BillingMappingError,
  entitledPlan,
  formatMoney,
  isStale,
  pastDueSince,
  planDecision,
  prorationMode,
  snapshotOf,
  targetPlan,
} from "./state";

const NOW = new Date("2026-11-20T00:00:00Z");
const DAY = 86_400_000;

/** The SDK's own parsing of a wire payload, as the webhook route gets it. */
function notification(data: ReturnType<typeof subscriptionData>): SubscriptionNotification {
  const e = Webhooks.fromJson(
    event("subscription.updated", data, {
      id: "evt_1",
      occurredAt: "2026-11-02T10:00:00Z",
    }) as never
  );
  return e.data as SubscriptionNotification;
}

describe("snapshotOf", () => {
  it("maps a subscription event to plan, interval and dates from the price's custom_data", () => {
    const snap = snapshotOf(
      notification(
        subscriptionData({
          id: "sub_1",
          customerId: "ctm_1",
          status: "active",
          priceId: TEAM_MONTHLY,
        })
      ),
      "sandbox"
    );
    expect(snap).toMatchObject({
      paddleSubscriptionId: "sub_1",
      paddleCustomerId: "ctm_1",
      paddlePriceId: TEAM_MONTHLY,
      plan: "team",
      interval: "month",
      status: "active",
      scheduledChange: null,
    });
    expect(snap.currentPeriodEnd?.toISOString()).toBe("2026-12-02T10:00:00.000Z");
  });

  it("falls back to the catalog when the price has no custom_data", () => {
    const data = subscriptionData({
      id: "sub_2",
      customerId: "ctm_1",
      status: "active",
      priceId: PRO_YEARLY,
    });
    data.items[0].price!.custom_data = null;
    expect(snapshotOf(notification(data), "sandbox")).toMatchObject({
      plan: "pro",
      interval: "year",
    });
  });

  it("refuses a subscription without a Briff price", () => {
    const data = subscriptionData({
      id: "sub_3",
      customerId: "ctm_1",
      status: "active",
      priceId: "pri_other",
    });
    data.items[0].price!.custom_data = { plan: "enterprise" };
    expect(() => snapshotOf(notification(data), "sandbox")).toThrow(BillingMappingError);
  });
});

describe("ordering and grace", () => {
  it("ignores a state older than the stored one, applies equal or newer", () => {
    const stored = new Date("2026-11-02T10:00:05Z");
    expect(isStale(stored, new Date("2026-11-02T10:00:04Z"))).toBe(true);
    expect(isStale(stored, stored)).toBe(false);
    expect(isStale(null, stored)).toBe(false);
  });

  it("starts the past_due clock once", () => {
    const first = new Date("2026-11-01T00:00:00Z");
    expect(pastDueSince("past_due", null, first)).toEqual(first);
    expect(pastDueSince("past_due", { status: "past_due", pastDueSince: first }, NOW)).toEqual(
      first
    );
    expect(pastDueSince("active", { status: "past_due", pastDueSince: first }, NOW)).toBeNull();
  });

  it("keeps the plan through 14 days of past_due, then Free", () => {
    const row = (days: number) => ({
      status: "past_due",
      plan: "pro" as const,
      pastDueSince: new Date(NOW.getTime() - days * DAY),
      currentPeriodEnd: null,
    });
    expect(entitledPlan(row(13), NOW)).toBe("pro");
    expect(entitledPlan(row(14), NOW)).toBe("free");
  });

  it("keeps a canceled plan only until the paid period ends; paused gives nothing", () => {
    const base = { plan: "team" as const, pastDueSince: null };
    expect(
      entitledPlan(
        { ...base, status: "canceled", currentPeriodEnd: new Date(NOW.getTime() + DAY) },
        NOW
      )
    ).toBe("team");
    expect(entitledPlan({ ...base, status: "canceled", currentPeriodEnd: null }, NOW)).toBe("free");
    expect(entitledPlan({ ...base, status: "paused", currentPeriodEnd: null }, NOW)).toBe("free");
    expect(entitledPlan({ ...base, status: "trialing", currentPeriodEnd: null }, NOW)).toBe("team");
  });

  it("takes the biggest plan of all the org's subscriptions", () => {
    const rows = [
      { status: "canceled", plan: "team" as const, pastDueSince: null, currentPeriodEnd: null },
      { status: "active", plan: "pro" as const, pastDueSince: null, currentPeriodEnd: null },
    ];
    expect(targetPlan(rows, NOW)).toBe("pro");
    expect(targetPlan([], NOW)).toBe("free");
  });
});

describe("planDecision", () => {
  it("never touches unlimited and never lowers an admin plan", () => {
    expect(planDecision({ plan: "unlimited", planSource: "admin" }, "pro")).toMatchObject({
      write: false,
    });
    expect(planDecision({ plan: "team", planSource: "admin" }, "free")).toEqual({
      write: false,
      reason: "admin-plan",
    });
    expect(planDecision({ plan: "team", planSource: "admin" }, "pro")).toEqual({
      write: false,
      reason: "admin-plan",
    });
  });

  it("applies upgrades, takes over an equal admin plan, and lowers its own plans", () => {
    expect(planDecision({ plan: "free", planSource: "default" }, "pro")).toEqual({
      write: true,
      plan: "pro",
    });
    expect(planDecision({ plan: "pro", planSource: "admin" }, "team")).toEqual({
      write: true,
      plan: "team",
    });
    expect(planDecision({ plan: "pro", planSource: "admin" }, "pro")).toEqual({
      write: true,
      plan: "pro",
    });
    expect(planDecision({ plan: "pro", planSource: "paddle" }, "pro")).toMatchObject({
      write: false,
    });
    expect(planDecision({ plan: "pro", planSource: "paddle" }, "free")).toEqual({
      write: true,
      plan: "free",
    });
  });
});

describe("prorationMode", () => {
  it("charges upgrades now and settles downgrades on the next bill", () => {
    expect(
      prorationMode({ plan: "pro", interval: "month" }, { plan: "team", interval: "month" })
    ).toBe("prorated_immediately");
    expect(
      prorationMode({ plan: "pro", interval: "month" }, { plan: "pro", interval: "year" })
    ).toBe("prorated_immediately");
    expect(
      prorationMode({ plan: "team", interval: "month" }, { plan: "pro", interval: "year" })
    ).toBe("prorated_next_billing_period");
    expect(
      prorationMode({ plan: "pro", interval: "year" }, { plan: "pro", interval: "month" })
    ).toBe("prorated_next_billing_period");
  });
});

describe("catalog, money and the signed org link", () => {
  it("has every sandbox price and no live ones yet", () => {
    expect(catalogComplete("sandbox")).toBe(true);
    expect(catalogComplete("live")).toBe(false);
    expect(new Set(PADDLE_CATALOG.sandbox.map((p) => p.priceId)).size).toBe(4);
    expect(priceFor("sandbox", "team", "year")?.priceId).toBe("pri_01m6c6ehv90djqb9e6qy0yxwq2");
  });

  it("formats lowest-unit amounts, zero-decimal currencies included", () => {
    expect(formatMoney("1200", "USD")).toBe("$12.00");
    expect(formatMoney("1200", "JPY")).toBe("¥1,200");
  });

  it("trusts custom_data.orgId only with its signature", () => {
    const secret = "s".repeat(32);
    const data = checkoutCustomData(secret, "org_a");
    expect(signedOrgId(secret, data)).toBe("org_a");
    expect(signedOrgId(secret, { ...data, orgId: "org_b" })).toBeNull();
    expect(signedOrgId("t".repeat(32), data)).toBeNull();
    expect(signedOrgId(secret, { orgId: "org_a" })).toBeNull();
    expect(signedOrgId(secret, null)).toBeNull();
  });
});
