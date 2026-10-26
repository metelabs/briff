import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it, vi } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { log } from "@/lib/log";

import { publicActionsForScan } from "./action-visibility";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("Actions visibility progress", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const names = Array.from({ length: 62 }, (_, i) => `acme/visibility-${Date.now()}-${i}`);
  const reset = new Date(Math.ceil(Date.now() / 1000) * 1000 + 3_600_000);
  const dedupeKey = `security-scan:action-visibility:${reset.toISOString()}`;
  afterAll(async () => {
    vi.unstubAllGlobals();
    await db.package.deleteMany({ where: { name: { in: names } } });
    await db.job.deleteMany({ where: { dedupeKey } });
    await db.$disconnect();
  });

  it("persists the first budget, defers remaining checks, and resumes without rechecking it", async () => {
    await db.package.createMany({
      data: names.map((name) => ({ name, ecosystem: "GitHub Actions" })),
    });
    let requests = 0;
    const fetcher = vi.fn(async () => {
      if (++requests === 61)
        return new Response(null, {
          status: 403,
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(reset.getTime() / 1000),
          },
        });
      return Response.json({ private: false });
    });
    vi.stubGlobal("fetch", fetcher);
    const context = { db, log, heartbeat: vi.fn(async () => undefined) };
    expect((await publicActionsForScan(context, names)).size).toBe(60);
    expect(requests).toBe(61);
    expect(await db.job.findFirst({ where: { dedupeKey } })).toMatchObject({ runAfter: reset });
    expect(
      await db.package.count({ where: { name: { in: names }, actionVisibilityRetryAt: reset } })
    ).toBe(2);
    expect((await publicActionsForScan(context, names)).size).toBe(60);
    expect(requests).toBe(61);
    expect(await db.job.count({ where: { dedupeKey } })).toBe(1);
    // Move the persisted deadline past instead of advancing the DB server's clock.
    await db.package.updateMany({
      where: { name: { in: names }, actionPublic: null },
      data: { actionVisibilityRetryAt: new Date(0) },
    });
    expect((await publicActionsForScan(context, names)).size).toBe(62);
    expect(requests).toBe(63);
    expect(context.heartbeat).toHaveBeenCalledTimes(63);
  });
});
