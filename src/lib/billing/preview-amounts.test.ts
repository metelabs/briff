import { describe, expect, it } from "vitest";

import { previewAmounts } from "./api";

const usd = (total: string) => ({ total, currencyCode: "USD" });

describe("previewAmounts", () => {
  it("reads a charge now and the new recurring price", () => {
    expect(
      previewAmounts({
        immediateTransaction: { details: { totals: usd("10800") } },
        recurringTransactionDetails: { totals: usd("12000") },
        updateSummary: { result: { action: "charge", amount: "10800", currencyCode: "USD" } },
        nextBilledAt: "2027-11-02T09:24:19Z",
      })
    ).toMatchObject({ dueNow: "$108.00", credit: null, recurring: "$120.00" });
  });

  // Shape of the sandbox answer for Team yearly -> Pro monthly, prorated_immediately.
  it("reads a credit from the update summary", () => {
    expect(
      previewAmounts({
        immediateTransaction: { details: { totals: usd("-11630") } },
        recurringTransactionDetails: { totals: usd("400") },
        updateSummary: { result: { action: "credit", amount: "11630", currencyCode: "USD" } },
        nextBilledAt: "2026-12-02T09:40:31Z",
      })
    ).toMatchObject({ dueNow: null, credit: "$116.30", recurring: "$4.00" });
    expect(
      previewAmounts({
        immediateTransaction: null,
        recurringTransactionDetails: { totals: usd("400") },
        updateSummary: { result: { action: "credit", amount: "500", currencyCode: "USD" } },
        nextBilledAt: null,
      })
    ).toMatchObject({ dueNow: null, credit: "$5.00" });
  });
});
