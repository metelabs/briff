import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";

import { generateScanToken, type StoredScanToken } from "./tokens";

export interface ScanTokenView {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

const VIEW_SELECT = {
  id: true,
  name: true,
  prefix: true,
  createdAt: true,
  lastUsedAt: true,
  revokedAt: true,
} as const;

/**
 * The scan endpoint's token lookup. It runs before the org is known, so it is the one
 * ScanToken read outside withOrg; it returns only what resolveScanAuth needs.
 */
export function findScanTokenByHash(
  db: PrismaClient,
  tokenHash: string
): Promise<StoredScanToken | null> {
  return db.scanToken.findUnique({
    where: { tokenHash },
    select: { id: true, orgId: true, revokedAt: true },
  });
}

export async function touchScanToken(
  db: PrismaClient,
  orgId: string,
  tokenId: string,
  now: Date
): Promise<void> {
  await withOrg(db, orgId).scanToken.update({
    where: { id: tokenId },
    data: { lastUsedAt: now },
  });
}

/** Active tokens first (newest first), then revoked ones. */
export async function listScanTokens(db: PrismaClient, orgId: string): Promise<ScanTokenView[]> {
  const rows = await withOrg(db, orgId).scanToken.findMany({
    select: VIEW_SELECT,
    orderBy: { createdAt: "desc" },
  });
  return [...rows.filter((t) => !t.revokedAt), ...rows.filter((t) => t.revokedAt)];
}

export async function createScanToken(
  db: PrismaClient,
  orgId: string,
  input: { name: string; userId: string | null }
): Promise<{ token: ScanTokenView; secret: string }> {
  const { secret, tokenHash, prefix } = generateScanToken();
  const token = await withOrg(db, orgId).scanToken.create({
    data: { orgId, name: input.name, tokenHash, prefix, createdByUserId: input.userId },
    select: VIEW_SELECT,
  });
  return { token, secret };
}

/** Idempotent; returns false when the org has no such active token. */
export async function revokeScanToken(
  db: PrismaClient,
  orgId: string,
  tokenId: string,
  now: Date
): Promise<boolean> {
  const { count } = await withOrg(db, orgId).scanToken.updateMany({
    where: { id: tokenId, revokedAt: null },
    data: { revokedAt: now },
  });
  return count > 0;
}

/** The newest active token with this name, if any (onboarding reuses it). */
export async function findActiveScanToken(
  db: PrismaClient,
  orgId: string,
  name: string
): Promise<ScanTokenView | null> {
  return withOrg(db, orgId).scanToken.findFirst({
    where: { name, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: VIEW_SELECT,
  });
}

/**
 * Onboarding's token: reuses the org's active token with this name (its secret is gone,
 * so `secret` is null), else creates one and returns its secret once.
 */
export async function ensureNamedScanToken(
  db: PrismaClient,
  orgId: string,
  input: { name: string; userId: string | null }
): Promise<{ token: ScanTokenView; secret: string | null; created: boolean }> {
  const existing = await findActiveScanToken(db, orgId, input.name);
  if (existing) return { token: existing, secret: null, created: false };
  const { token, secret } = await createScanToken(db, orgId, input);
  return { token, secret, created: true };
}
