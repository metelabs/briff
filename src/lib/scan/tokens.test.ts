import { describe, expect, it } from "vitest";

import { sha256Hex } from "@/lib/crypto";

import {
  generateScanToken,
  hashScanToken,
  isScanTokenSecret,
  resolveScanAuth,
  type StoredScanToken,
} from "./tokens";

const LEGACY = "legacy-token-".padEnd(40, "x");

function lookupOf(rows: Record<string, StoredScanToken>) {
  const seen: string[] = [];
  const find = async (hash: string) => {
    seen.push(hash);
    return rows[hash] ?? null;
  };
  return { find, seen };
}

describe("scan token secrets", () => {
  it("are brf_ plus 40 url-safe characters, with an 8-character display prefix", () => {
    const token = generateScanToken();
    expect(token.secret).toMatch(/^brf_[A-Za-z0-9_-]{40}$/);
    expect(token.secret).toHaveLength(44);
    expect(token.prefix).toBe(token.secret.slice(0, 8));
    expect(isScanTokenSecret(token.secret)).toBe(true);
  });

  it("are random", () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateScanToken().secret));
    expect(secrets.size).toBe(50);
  });

  it("are stored as their sha256 hex digest only", () => {
    const token = generateScanToken();
    expect(token.tokenHash).toBe(sha256Hex(token.secret));
    expect(hashScanToken(token.secret)).toMatch(/^[0-9a-f]{64}$/);
    expect(token.tokenHash).not.toContain(token.secret.slice(4));
  });

  it("reject other shapes", () => {
    expect(isScanTokenSecret("brf_short")).toBe(false);
    expect(isScanTokenSecret(`brf_${"a".repeat(39)}!`)).toBe(false);
    expect(isScanTokenSecret(`xyz_${"a".repeat(40)}`)).toBe(false);
  });
});

describe("resolveScanAuth", () => {
  const active = generateScanToken();
  const revoked = generateScanToken();
  const rows = {
    [active.tokenHash]: { id: "t1", orgId: "org-a", revokedAt: null },
    [revoked.tokenHash]: { id: "t2", orgId: "org-b", revokedAt: new Date("2026-10-01") },
  };

  it("resolves the org from a Bearer scan token", async () => {
    const { find, seen } = lookupOf(rows);
    await expect(resolveScanAuth(`Bearer ${active.secret}`, find, LEGACY)).resolves.toEqual({
      ok: true,
      kind: "token",
      orgId: "org-a",
      tokenId: "t1",
    });
    expect(seen).toEqual([active.tokenHash]);
  });

  it("refuses a revoked token, even when a legacy token is configured", async () => {
    const { find } = lookupOf(rows);
    await expect(resolveScanAuth(`Bearer ${revoked.secret}`, find, LEGACY)).resolves.toEqual({
      ok: false,
      reason: "revoked",
    });
  });

  it("falls back to the legacy SCANNER_TOKEN without a lookup", async () => {
    const { find, seen } = lookupOf(rows);
    await expect(resolveScanAuth(`Bearer ${LEGACY}`, find, LEGACY)).resolves.toEqual({
      ok: true,
      kind: "legacy",
    });
    expect(seen).toEqual([]);
  });

  it("refuses a wrong token", async () => {
    const { find } = lookupOf(rows);
    const unknown = generateScanToken().secret;
    await expect(resolveScanAuth(`Bearer ${unknown}`, find, LEGACY)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
    await expect(resolveScanAuth("Bearer nope", find, LEGACY)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("refuses the legacy token once SCANNER_TOKEN is unset", async () => {
    const { find } = lookupOf(rows);
    await expect(resolveScanAuth(`Bearer ${LEGACY}`, find, undefined)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("refuses a missing or malformed header", async () => {
    const { find } = lookupOf(rows);
    for (const header of [null, "", active.secret, "Basic abc"]) {
      await expect(resolveScanAuth(header, find, LEGACY)).resolves.toEqual({
        ok: false,
        reason: "missing",
      });
    }
  });
});
