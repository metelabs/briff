import { describe, expect, it } from "vitest";

import { signState, STATE_TTL_MS, verifyState } from "./state";

describe("install state", () => {
  const secret = "s".repeat(40);
  const now = new Date("2026-10-24T12:00:00Z");
  const base = { purpose: "install" as const, orgId: "org-1", userId: "user-1" };

  it("round-trips within the TTL", () => {
    const token = signState(secret, base, now);
    expect(verifyState(secret, token, now)).toMatchObject(base);
    const verify = signState(secret, { ...base, purpose: "verify", installationId: "42" }, now);
    expect(verifyState(secret, verify, now)).toMatchObject({
      purpose: "verify",
      installationId: "42",
    });
  });

  it("refuses expired, tampered, foreign or malformed states", () => {
    const token = signState(secret, base, now);
    expect(verifyState(secret, token, new Date(now.getTime() + STATE_TTL_MS))).toBeNull();
    expect(verifyState("t".repeat(40), token, now)).toBeNull();
    const [body, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...base, orgId: "org-2", exp: now.getTime() + 1000 })
    ).toString("base64url");
    expect(verifyState(secret, `${forged}.${sig}`, now)).toBeNull();
    expect(verifyState(secret, `${body}.${sig}.x`, now)).toBeNull();
    expect(verifyState(secret, null, now)).toBeNull();
    expect(verifyState(secret, "garbage", now)).toBeNull();
  });
});
