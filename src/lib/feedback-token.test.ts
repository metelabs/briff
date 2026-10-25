import { describe, expect, it } from "vitest";

import { FEEDBACK_TOKEN_TTL_DAYS, signFeedbackToken, verifyFeedbackToken } from "./feedback-token";

const SECRET = "s".repeat(48);
const now = new Date("2026-10-15T00:00:00Z");

describe("feedback token", () => {
  const token = signFeedbackToken(SECRET, "bulletin1", "user1", now);

  it("verifies for the same bulletin and returns the recipient", () => {
    expect(verifyFeedbackToken(SECRET, "bulletin1", token, now)).toBe("user1");
  });

  it("is bound to the bulletin and the secret", () => {
    expect(verifyFeedbackToken(SECRET, "bulletin2", token, now)).toBeNull();
    expect(verifyFeedbackToken("t".repeat(48), "bulletin1", token, now)).toBeNull();
  });

  it("rejects a swapped user or a tampered expiry", () => {
    const [, exp, sig] = token.split(".");
    const otherUser = `${Buffer.from("user2").toString("base64url")}.${exp}.${sig}`;
    expect(verifyFeedbackToken(SECRET, "bulletin1", otherUser, now)).toBeNull();
    const [user] = token.split(".");
    expect(
      verifyFeedbackToken(SECRET, "bulletin1", `${user}.${Number(exp) + 1}.${sig}`, now)
    ).toBeNull();
    expect(verifyFeedbackToken(SECRET, "bulletin1", "garbage", now)).toBeNull();
    expect(verifyFeedbackToken(SECRET, "bulletin1", "a.b.c", now)).toBeNull();
  });

  it("expires", () => {
    const later = new Date(now.getTime() + (FEEDBACK_TOKEN_TTL_DAYS + 1) * 86_400_000);
    expect(verifyFeedbackToken(SECRET, "bulletin1", token, later)).toBeNull();
  });
});
