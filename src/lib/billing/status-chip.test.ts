import { describe, expect, it } from "vitest";

import { statusChip } from "./status-chip";

const NOW = new Date("2026-11-02T09:30:00Z");
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

describe("statusChip", () => {
  it("reads Canceled, not Ends soon, for a cancel a year away", () => {
    // The first sandbox checkout: Team yearly, canceled at period end on 2 November 2027.
    expect(statusChip({ status: "active", endsAt: at(365), graceEndsAt: null }, NOW)).toEqual({
      kind: "wait",
      label: "Canceled",
    });
    expect(statusChip({ status: "active", endsAt: at(31), graceEndsAt: null }, NOW)?.label).toBe(
      "Canceled"
    );
  });

  it("reads Ends soon within 30 days and Ended after the end", () => {
    expect(statusChip({ status: "active", endsAt: at(30), graceEndsAt: null }, NOW)).toEqual({
      kind: "upgrade",
      label: "Ends soon",
    });
    expect(statusChip({ status: "canceled", endsAt: at(0.5), graceEndsAt: null }, NOW)?.label).toBe(
      "Ends soon"
    );
    expect(statusChip({ status: "canceled", endsAt: at(-1), graceEndsAt: null }, NOW)).toEqual({
      kind: "wait",
      label: "Ended",
    });
    expect(statusChip({ status: "canceled", endsAt: null, graceEndsAt: null }, NOW)?.label).toBe(
      "Ended"
    );
  });

  it("counts down a failed payment's grace period", () => {
    expect(statusChip({ status: "past_due", endsAt: null, graceEndsAt: at(9.2) }, NOW)).toEqual({
      kind: "upgrade",
      label: "Payment failed · 10 days left",
    });
    expect(statusChip({ status: "past_due", endsAt: null, graceEndsAt: at(0.1) }, NOW)?.label).toBe(
      "Payment failed · 1 day left"
    );
    expect(
      statusChip({ status: "past_due", endsAt: null, graceEndsAt: at(-0.1) }, NOW)?.label
    ).toBe("Payment failed · plan ended");
    expect(statusChip({ status: "past_due", endsAt: null, graceEndsAt: null }, NOW)?.label).toBe(
      "Payment failed"
    );
  });

  it("names the other states", () => {
    expect(statusChip({ status: "active", endsAt: null, graceEndsAt: null }, NOW)?.label).toBe(
      "Active"
    );
    expect(statusChip({ status: "trialing", endsAt: null, graceEndsAt: null }, NOW)?.label).toBe(
      "Trial"
    );
    expect(statusChip({ status: "paused", endsAt: null, graceEndsAt: null }, NOW)?.label).toBe(
      "Paused"
    );
  });
});
