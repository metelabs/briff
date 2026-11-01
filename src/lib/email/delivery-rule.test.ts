import { describe, expect, it } from "vitest";

import { receivesDelivery, UNVERIFIED_GRACE_MS } from "./delivery-rule";

const now = new Date("2026-11-01T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

describe("receivesDelivery", () => {
  it("always delivers to a verified account", () => {
    expect(receivesDelivery({ emailVerified: true, createdAt: ago(365 * 86_400_000) }, now)).toBe(
      true
    );
  });

  it("delivers to an unverified account during its first 7 days only", () => {
    expect(receivesDelivery({ emailVerified: false, createdAt: ago(0) }, now)).toBe(true);
    expect(
      receivesDelivery({ emailVerified: false, createdAt: ago(UNVERIFIED_GRACE_MS - 1) }, now)
    ).toBe(true);
    expect(
      receivesDelivery({ emailVerified: false, createdAt: ago(UNVERIFIED_GRACE_MS) }, now)
    ).toBe(false);
  });
});
