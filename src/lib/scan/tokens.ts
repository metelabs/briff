import { randomBytes } from "node:crypto";

import { bearerToken, safeEqual, sha256Hex } from "@/lib/crypto";

export const SCAN_TOKEN_PREFIX = "brf_";
export const SCAN_TOKEN_NAME_MAX = 60;
const SECRET_PATTERN = /^brf_[A-Za-z0-9_-]{40}$/;
const DISPLAY_PREFIX_LENGTH = 8;

export interface NewScanToken {
  /** Shown once to the user; never stored. */
  secret: string;
  tokenHash: string;
  prefix: string;
}

export function hashScanToken(secret: string): string {
  return sha256Hex(secret);
}

export function isScanTokenSecret(value: string): boolean {
  return SECRET_PATTERN.test(value);
}

/** `brf_` + 40 url-safe characters (30 random bytes, base64url). */
export function generateScanToken(): NewScanToken {
  const secret = `${SCAN_TOKEN_PREFIX}${randomBytes(30).toString("base64url")}`;
  return {
    secret,
    tokenHash: hashScanToken(secret),
    prefix: secret.slice(0, DISPLAY_PREFIX_LENGTH),
  };
}

export interface StoredScanToken {
  id: string;
  orgId: string;
  revokedAt: Date | null;
}

export type ScanAuth =
  | { ok: true; kind: "token"; orgId: string; tokenId: string }
  | { ok: true; kind: "legacy" }
  | { ok: false; reason: "missing" | "revoked" | "invalid" };

/**
 * Resolves the caller of POST /api/scan. A `brf_` secret is looked up by its hash and
 * decides the org; anything else is compared with the deprecated instance-wide
 * SCANNER_TOKEN, whose org comes from SCANNER_ORG_ID (resolveScannerOrg).
 */
export async function resolveScanAuth(
  authorization: string | null,
  findByHash: (tokenHash: string) => Promise<StoredScanToken | null>,
  legacyToken: string | undefined
): Promise<ScanAuth> {
  const secret = bearerToken(authorization);
  if (!secret) return { ok: false, reason: "missing" };
  if (isScanTokenSecret(secret)) {
    const row = await findByHash(hashScanToken(secret));
    if (row) {
      return row.revokedAt
        ? { ok: false, reason: "revoked" }
        : { ok: true, kind: "token", orgId: row.orgId, tokenId: row.id };
    }
  }
  if (legacyToken && safeEqual(secret, legacyToken)) return { ok: true, kind: "legacy" };
  return { ok: false, reason: "invalid" };
}
