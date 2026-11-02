import { describe, expect, it } from "vitest";

import { billingOffer } from "./offer";

describe("billingOffer", () => {
  it("offers both plans to a Free org", () => {
    expect(billingOffer({ plan: "free", planSource: "default", subscribed: false })).toEqual({
      kind: "checkout",
      plans: ["pro", "team"],
    });
  });

  it("never offers the plan the org already has", () => {
    // A canceled Pro subscription still inside its paid period.
    expect(billingOffer({ plan: "pro", planSource: "paddle", subscribed: false })).toEqual({
      kind: "checkout",
      plans: ["team"],
    });
    expect(billingOffer({ plan: "team", planSource: "paddle", subscribed: false })).toEqual({
      kind: "checkout",
      plans: ["pro"],
    });
  });

  it("shows the admin notice for an admin-set paid plan and for Unlimited", () => {
    expect(billingOffer({ plan: "pro", planSource: "admin", subscribed: false })).toEqual({
      kind: "admin",
    });
    expect(billingOffer({ plan: "team", planSource: "admin", subscribed: false }).kind).toBe(
      "admin"
    );
    expect(billingOffer({ plan: "unlimited", planSource: "admin", subscribed: false }).kind).toBe(
      "admin"
    );
    expect(billingOffer({ plan: "unlimited", planSource: "default", subscribed: false }).kind).toBe(
      "admin"
    );
  });

  it("lets an admin-set Free org buy a plan", () => {
    expect(billingOffer({ plan: "free", planSource: "admin", subscribed: false })).toEqual({
      kind: "checkout",
      plans: ["pro", "team"],
    });
  });

  it("manages a live subscription whatever the plan source", () => {
    expect(billingOffer({ plan: "unlimited", planSource: "admin", subscribed: true }).kind).toBe(
      "subscribed"
    );
  });
});
