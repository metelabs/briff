import { describe, expect, it } from "vitest";

import { previewAmounts } from "./api";

const usd = (total: string) => ({ total, currencyCode: "USD" });

describe("previewAmounts", () => {
  it("reads a charge now and the new recurring price", () => {
    expect(
      previewAmounts({
        immediateTransaction: { details: { totals: usd("35100") } },
        recurringTransactionDetails: { totals: usd("39000") },
        updateSummary: { result: { action: "charge", amount: "35100", currencyCode: "USD" } },
        nextBilledAt: "2027-11-02T09:24:19Z",
      })
    ).toMatchObject({ dueNow: "$351.00", credit: null, recurring: "$390.00" });
  });

  // Sandbox answer for Team yearly -> Pro monthly, prorated_immediately.
  it("reads a credit from the update summary", () => {
    expect(
      previewAmounts({
        immediateTransaction: { details: { totals: usd("-37796") } },
        recurringTransactionDetails: { totals: usd("1200") },
        updateSummary: { result: { action: "credit", amount: "37796", currencyCode: "USD" } },
        nextBilledAt: "2026-12-02T09:40:31Z",
      })
    ).toMatchObject({ dueNow: null, credit: "$377.96", recurring: "$12.00" });
    expect(
      previewAmounts({
        immediateTransaction: null,
        recurringTransactionDetails: { totals: usd("1200") },
        updateSummary: { result: { action: "credit", amount: "500", currencyCode: "USD" } },
        nextBilledAt: null,
      })
    ).toMatchObject({ dueNow: null, credit: "$5.00" });
  });
});
