import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { resetEnvCache } from "@/lib/env";
import { utcDay } from "@/lib/llm-budget";
import { scanFollowUpKey } from "@/lib/scan/follow-up";

import { POST } from "./route";

// Abuse limits on POST /api/scan: a body cap (413, refused before buffering when
// content-length says so) and a per-org daily upload count from the plan (429).
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("POST /api/scan limits", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  const token = `scan-limits-${suffix}-${"x".repeat(24)}`;
  const saved = { ...process.env };
  let orgId = "";

  const body = (name = "a") =>
    JSON.stringify({
      source: "local",
      repos: [{ name, ecosystem: "npm", dependencies: [], runtimes: [] }],
    });
  const post = (init: RequestInit & { duplex?: "half" }) =>
    POST(
      new Request("http://127.0.0.1:3000/api/scan", {
        method: "POST",
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...(init.headers as Record<string, string> | undefined),
        },
      })
    );
  const setUploads = async (n: number) => {
    const scoped = withOrg(db, orgId);
    await scoped.orgUsage.deleteMany({});
    await scoped.orgUsage.create({ data: { orgId, day: utcDay(new Date()), scanUploads: n } });
  };

  beforeAll(async () => {
    orgId = (await db.org.create({ data: { name: `scan-limits-${suffix}`, plan: "free" } })).id;
    Object.assign(process.env, {
      DATABASE_URL: url,
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "https://app.example.com/",
      NODE_ENV: "test",
      SCANNER_TOKEN: token,
      SCANNER_ORG_ID: orgId,
      BRIFF_CLOUD: "true",
      BRIFF_SCAN_MAX_BYTES: "2000",
    });
    resetEnvCache();
  });

  afterAll(async () => {
    await db.job.deleteMany({ where: { dedupeKey: scanFollowUpKey(orgId) } });
    await db.org.deleteMany({ where: { id: orgId } });
    await db.$disconnect();
    await getDb().$disconnect();
    process.env = saved;
    resetEnvCache();
  });

  it("refuses a body over the cap with 413, by content-length and by the bytes read", async () => {
    const big = body("x".repeat(3000));
    const declared = await post({ body: big, headers: { "content-length": String(big.length) } });
    expect(declared.status).toBe(413);
    expect(await declared.json()).toMatchObject({
      code: "SCAN_TOO_LARGE",
      error: expect.stringContaining("larger than"),
    });
    // Chunked, no content-length: the read stops at the cap.
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(big));
        c.close();
      },
    });
    const chunked = await post({ body: stream, duplex: "half" });
    expect(chunked.status).toBe(413);
    // Nothing was counted against the daily limit.
    expect(await withOrg(db, orgId).orgUsage.count()).toBe(0);
  });

  it("counts uploads per day and answers 429 past the plan's limit", async () => {
    expect((await post({ body: body() })).status).toBe(200);
    const [row] = await withOrg(db, orgId).orgUsage.findMany({ select: { scanUploads: true } });
    expect(row.scanUploads).toBe(1);

    await setUploads(20);
    const refused = await post({ body: body() });
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await refused.json()).toEqual({
      code: "SCAN_RATE_LIMIT",
      error:
        "Daily scan upload limit reached (20 on the Free plan). It resets at 00:00 UTC; see Settings → Billing for the plans.",
    });

    // Pro allows 200 a day.
    await db.org.update({ where: { id: orgId }, data: { plan: "pro" } });
    expect((await post({ body: body() })).status).toBe(200);
    await db.org.update({ where: { id: orgId }, data: { plan: "free" } });
  });

  it("has no daily limit on a self-hosted instance", async () => {
    process.env.BRIFF_CLOUD = "false";
    resetEnvCache();
    try {
      await setUploads(500);
      expect((await post({ body: body() })).status).toBe(200);
    } finally {
      process.env.BRIFF_CLOUD = "true";
      resetEnvCache();
    }
  });
});
