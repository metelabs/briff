import { describe, expect, it } from "vitest";

import { renderBillingEmail } from "./billing-email";

const args = { orgName: "Acme\nStudio", instanceUrl: "https://briff.example.com/" };

describe("billing emails", () => {
  it("links every email to the billing page, never to a portal session", () => {
    for (const email of [
      { kind: "plan-changed" as const, from: "free" as const, to: "pro" as const },
      {
        kind: "payment-failed" as const,
        plan: "team" as const,
        graceEndsAt: new Date("2026-11-20T00:00:00Z"),
      },
      { kind: "canceled" as const, plan: "pro" as const, endsAt: new Date("2026-12-02T10:00:00Z") },
    ]) {
      const out = renderBillingEmail(email, args);
      expect(out.html).toContain('href="https://briff.example.com/settings/billing"');
      expect(out.text).toContain("https://briff.example.com/settings/billing");
      expect(out.subject).not.toMatch(/\n/);
      expect(out.html).not.toContain("portal.paddle");
    }
  });

  it("says what changed, until when, and what to do", () => {
    expect(
      renderBillingEmail({ kind: "plan-changed", from: "free", to: "pro" }, args)
    ).toMatchObject({
      subject: "Acme Studio is on the Pro plan",
    });
    expect(
      renderBillingEmail({ kind: "plan-changed", from: "pro", to: "free" }, args).subject
    ).toBe("Acme Studio is on the Free plan now");
    const failed = renderBillingEmail(
      { kind: "payment-failed", plan: "team", graceEndsAt: new Date("2026-11-20T00:00:00Z") },
      args
    );
    expect(failed.subject).toBe("Payment failed for Acme Studio");
    expect(failed.text).toContain("keeps Team until 20 November 2026");
    expect(
      renderBillingEmail(
        { kind: "canceled", plan: "pro", endsAt: new Date("2026-12-02T10:00:00Z") },
        args
      ).subject
    ).toBe("Acme Studio: Pro ends on 2 December 2026");
  });
});
