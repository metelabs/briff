import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { resetEnvCache } from "@/lib/env";
import { scanFollowUpKey } from "@/lib/scan/follow-up";
import { createScanToken, listScanTokens, revokeScanToken } from "@/lib/scan/token-store";

import { POST } from "./route";

// Runs only when TEST_DATABASE_URL points at a migrated, disposable database.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("POST /api/scan authenticates with per-org scan tokens", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  const legacy = `legacy-${suffix}-${"y".repeat(24)}`;
  const saved = { ...process.env };
  let orgA = "";
  let orgB = "";

  const upload = (secret: string, repo: string) =>
    POST(
      new Request("http://127.0.0.1:3000/api/scan", {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify({
          source: "local",
          scanId: `run-${repo}`,
          final: true,
          repos: [{ name: repo, ecosystem: "npm", dependencies: [] }],
        }),
      })
    );
  const repoNames = async (orgId: string) =>
    (await withOrg(db, orgId).repo.findMany({ select: { name: true } })).map((r) => r.name).sort();

  beforeAll(async () => {
    orgA = (await db.org.create({ data: { name: `tokens-a-${suffix}` } })).id;
    orgB = (await db.org.create({ data: { name: `tokens-b-${suffix}` } })).id;
    Object.assign(process.env, {
      DATABASE_URL: url,
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "https://app.example.com/",
      NODE_ENV: "test",
      SCANNER_TOKEN: legacy,
      SCANNER_ORG_ID: orgB,
    });
    resetEnvCache();
  });

  afterAll(async () => {
    await db.job.deleteMany({
      where: { dedupeKey: { in: [scanFollowUpKey(orgA), scanFollowUpKey(orgB)] } },
    });
    await db.org.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.$disconnect();
    await getDb().$disconnect();
    process.env = saved;
    resetEnvCache();
  });

  it("files the upload under the token's org and records when it was used", async () => {
    const { token, secret } = await createScanToken(db, orgA, { name: "CI", userId: null });
    expect(token.lastUsedAt).toBeNull();
    const stored = await withOrg(db, orgA).scanToken.findUniqueOrThrow({ where: { id: token.id } });
    expect(stored.tokenHash).not.toContain(secret);
    expect(stored.prefix).toBe(secret.slice(0, 8));

    const before = Date.now();
    const res = await upload(secret, "from-token");
    expect(res.status).toBe(200);
    expect(await repoNames(orgA)).toEqual(["from-token"]);
    expect(await repoNames(orgB)).toEqual([]);
    const [listed] = await listScanTokens(db, orgA);
    expect(listed.lastUsedAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("refuses a revoked token with 401 and stores nothing", async () => {
    const { token, secret } = await createScanToken(db, orgA, { name: "old", userId: null });
    // Another org cannot revoke it.
    expect(await revokeScanToken(db, orgB, token.id, new Date())).toBe(false);
    expect(await revokeScanToken(db, orgA, token.id, new Date())).toBe(true);
    expect(await revokeScanToken(db, orgA, token.id, new Date())).toBe(false);

    const res = await upload(secret, "after-revoke");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "This scan token was revoked." });
    expect(await repoNames(orgA)).not.toContain("after-revoke");
    const tokens = await listScanTokens(db, orgA);
    expect(tokens.at(-1)?.id).toBe(token.id);
  });

  it("refuses a wrong token", async () => {
    const res = await upload(`brf_${"z".repeat(40)}`, "wrong");
    expect(res.status).toBe(401);
    const missing = await POST(new Request("http://127.0.0.1:3000/api/scan", { method: "POST" }));
    expect(missing.status).toBe(401);
  });

  it("keeps the legacy SCANNER_TOKEN working for SCANNER_ORG_ID", async () => {
    const res = await upload(legacy, "from-legacy");
    expect(res.status).toBe(200);
    expect(await repoNames(orgB)).toEqual(["from-legacy"]);
  });
});
