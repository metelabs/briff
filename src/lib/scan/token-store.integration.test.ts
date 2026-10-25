import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

import {
  createScanToken,
  ensureNamedScanToken,
  findActiveScanToken,
  listScanTokens,
  revokeScanToken,
} from "./token-store";

// Runs only when TEST_DATABASE_URL points at a migrated, disposable database.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("scan token store", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  let orgA = "";
  let orgB = "";
  const userId = `store-user-${suffix}`;

  beforeAll(async () => {
    await db.user.create({ data: { id: userId, name: "Store", email: `${userId}@example.com` } });
    orgA = (await db.org.create({ data: { name: `store-a-${suffix}` } })).id;
    orgB = (await db.org.create({ data: { name: `store-b-${suffix}` } })).id;
  });

  afterAll(async () => {
    await db.org.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  });

  it("finds the org's active token by name, never another org's or a revoked one", async () => {
    expect(await findActiveScanToken(db, orgA, "GitHub Action")).toBeNull();
    const { token } = await createScanToken(db, orgA, { name: "GitHub Action", userId: null });
    await createScanToken(db, orgB, { name: "GitHub Action", userId: null });

    const found = await findActiveScanToken(db, orgA, "GitHub Action");
    expect(found?.id).toBe(token.id);
    expect(found).not.toHaveProperty("tokenHash");

    await revokeScanToken(db, orgA, token.id, new Date());
    expect(await findActiveScanToken(db, orgA, "GitHub Action")).toBeNull();
    expect(await findActiveScanToken(db, orgB, "GitHub Action")).not.toBeNull();
  });

  it("lists active tokens newest first, then revoked ones, without secrets", async () => {
    const tokens = await listScanTokens(db, orgA);
    expect(tokens.every((t) => !("tokenHash" in t))).toBe(true);
    const { token: newer } = await createScanToken(db, orgA, { name: "laptop", userId: null });
    const listed = await listScanTokens(db, orgA);
    expect(listed[0].id).toBe(newer.id);
    expect(listed.at(-1)?.revokedAt).not.toBeNull();
  });

  it("onboarding creates its token once per org and shows the secret only then", async () => {
    const first = await ensureNamedScanToken(db, orgA, { name: "Local scanner", userId });
    expect(first.created).toBe(true);
    expect(first.secret).toMatch(/^brf_/);
    expect(first.token.prefix).toBe(first.secret?.slice(0, 8));
    const row = await db.scanToken.findUniqueOrThrow({ where: { id: first.token.id } });
    expect(row).toMatchObject({ orgId: orgA, createdByUserId: userId, name: "Local scanner" });

    // Reused while active, without the secret; another org gets its own.
    const again = await ensureNamedScanToken(db, orgA, { name: "Local scanner", userId });
    expect(again).toMatchObject({ created: false, secret: null });
    expect(again.token.id).toBe(first.token.id);
    const other = await ensureNamedScanToken(db, orgB, { name: "Local scanner", userId });
    expect(other.created).toBe(true);
    expect(other.token.id).not.toBe(first.token.id);

    // A revoked one is replaced by a new token with a fresh secret.
    await revokeScanToken(db, orgA, first.token.id, new Date());
    const replaced = await ensureNamedScanToken(db, orgA, { name: "Local scanner", userId });
    expect(replaced.created).toBe(true);
    expect(replaced.token.id).not.toBe(first.token.id);
    expect(replaced.secret).not.toBe(first.secret);
  });
});
