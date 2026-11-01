import { randomBytes } from "node:crypto";

import { sha256Hex } from "@/lib/crypto";

// Invite links (`/invite/<token>`): 32 random bytes, base64url. Only the sha256 is stored,
// like scan tokens, so a database copy cannot be turned into working links.

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return sha256Hex(token);
}

export function isInviteToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

export function inviteUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, "")}/invite/${token}`;
}

/** Emails are compared lower-cased and trimmed, as Better Auth stores them. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

export function inviteStatus(
  invite: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now: Date
): InviteStatus {
  if (invite.acceptedAt) return "accepted";
  if (invite.revokedAt) return "revoked";
  if (invite.expiresAt.getTime() <= now.getTime()) return "expired";
  return "pending";
}
