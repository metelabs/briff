import { createHmac, timingSafeEqual } from "node:crypto";

// GitHub signs every webhook delivery: `X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the
// raw body keyed with the webhook secret>`. Checked on the raw bytes, before any parsing.

export function webhookSignature(secret: string, body: Uint8Array): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export function verifyWebhookSignature(
  secret: string,
  body: Uint8Array,
  header: string | null
): boolean {
  if (!header || !/^sha256=[0-9a-f]{64}$/.test(header)) return false;
  const expected = Buffer.from(webhookSignature(secret, body));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
