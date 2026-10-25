import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

// Signed one-click feedback links in bulletin emails (`/b/<id>?fb=<itemId>:up&t=<token>`).
// The token binds a recipient (userId) to one bulletin; the page still checks that
// the user belongs to the bulletin's org and the item is in that bulletin.
// Format: base64url(userId) "." expiry (unix seconds) "." base64url(hmac).

const PURPOSE = "briff:feedback-link:v1";
export const FEEDBACK_TOKEN_TTL_DAYS = 90;

function key(secret: string): Buffer {
  return createHmac("sha256", secret).update(PURPOSE).digest();
}

function mac(secret: string, bulletinId: string, userId: string, exp: number): Buffer {
  return createHmac("sha256", key(secret)).update(`${bulletinId}\n${userId}\n${exp}`).digest();
}

export function signFeedbackToken(
  secret: string,
  bulletinId: string,
  userId: string,
  now: Date = new Date()
): string {
  const exp = Math.floor(now.getTime() / 1000) + FEEDBACK_TOKEN_TTL_DAYS * 86_400;
  const sig = mac(secret, bulletinId, userId, exp).toString("base64url");
  return `${Buffer.from(userId).toString("base64url")}.${exp}.${sig}`;
}

/** Returns the recipient's userId when the token is valid for this bulletin. */
export function verifyFeedbackToken(
  secret: string,
  bulletinId: string,
  token: string,
  now: Date = new Date()
): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userPart, expPart, sigPart] = parts;
  if (!/^\d{1,12}$/.test(expPart)) return null;
  const exp = Number(expPart);
  if (exp * 1000 < now.getTime()) return null;
  const userId = Buffer.from(userPart, "base64url").toString("utf8");
  if (!userId) return null;
  const expected = mac(secret, bulletinId, userId, exp);
  const given = Buffer.from(sigPart, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return userId;
}
