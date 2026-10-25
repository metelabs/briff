import { describe, expect, it } from "vitest";

import { verifyWebhookSignature, webhookSignature } from "./signature";

describe("webhook signature", () => {
  const secret = "It's a Secret to Everybody";
  const body = new TextEncoder().encode("Hello, World!");

  it("matches GitHub's documented example", () => {
    // docs.github.com, "Validating webhook deliveries": the expected signature for this pair.
    expect(webhookSignature(secret, body)).toBe(
      "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17"
    );
  });

  it("accepts the right signature and refuses anything else", () => {
    const good = webhookSignature(secret, body);
    expect(verifyWebhookSignature(secret, body, good)).toBe(true);
    expect(verifyWebhookSignature("other", body, good)).toBe(false);
    expect(verifyWebhookSignature(secret, new TextEncoder().encode("Hello, World?"), good)).toBe(
      false
    );
    expect(verifyWebhookSignature(secret, body, null)).toBe(false);
    expect(verifyWebhookSignature(secret, body, good.replace("sha256=", "sha1="))).toBe(false);
    expect(verifyWebhookSignature(secret, body, `${good}00`)).toBe(false);
    expect(verifyWebhookSignature(secret, body, good.toUpperCase())).toBe(false);
  });
});
