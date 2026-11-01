import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/db/client";
import { resetEnvCache } from "@/lib/env";
import { SCHEDULED_TYPES } from "@/lib/ops/freshness";

import { GET } from "./route";

const url = process.env.TEST_DATABASE_URL;
const HOUR = 3_600_000;

describe.skipIf(!url)("GET /api/health freshness", () => {
  const suffix = Date.now().toString(36);
  const runIds: string[] = [];
  const request = (query = "") => new Request(`http://127.0.0.1:3000/api/health${query}`);

  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", url ?? "");
    resetEnvCache();
    const db = getDb();
    // ops-check runs only in these tests; every other scheduled type gets a fresh success.
    await db.run.deleteMany({ where: { jobType: "ops-check" } });
    const now = Date.now();
    for (const jobType of SCHEDULED_TYPES.filter((t) => t !== "ops-check")) {
      const run = await db.run.create({
        data: {
          jobType,
          status: "succeeded",
          startedAt: new Date(now - 60_000),
          finishedAt: new Date(now),
        },
      });
      runIds.push(run.id);
    }
    // ops-check is allowed 2.5h; this success is 3 days old.
    const stale = await db.run.create({
      data: {
        jobType: "ops-check",
        status: "succeeded",
        startedAt: new Date(now - 72 * HOUR),
        finishedAt: new Date(now - 72 * HOUR),
      },
    });
    runIds.push(stale.id);
  });

  afterAll(async () => {
    const db = getDb();
    await db.run.deleteMany({ where: { id: { in: runIds } } });
    await db.job.deleteMany({ where: { dedupeKey: { startsWith: `health-${suffix}` } } });
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("is 503 with an informative body while a scheduled job type is stale", async () => {
    const res = await GET(request());
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      ok: boolean;
      db: string;
      stale: string[];
      freshness: Record<string, { status: string; lastSuccessAt: string | null }>;
      queue: { oldestPendingSeconds: number | null };
      lastRuns: Record<string, unknown>;
    };
    expect(body.ok).toBe(false);
    expect(body.db).toBe("ok");
    expect(body.stale).toEqual(["ops-check"]);
    expect(body.freshness["ops-check"].status).toBe("stale");
    expect(body.freshness["security-scan"].status).toBe("ok");
    expect(body.lastRuns).toHaveProperty("security-scan");
  });

  it("keeps the liveness probe at 200 so the web container is not restarted", async () => {
    const res = await GET(request("?probe=live"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: "ok" });
  });

  it("is 200 once the type succeeds again, and 503 again for a due job waiting over an hour", async () => {
    const db = getDb();
    const fresh = await db.run.create({
      data: { jobType: "ops-check", status: "succeeded", finishedAt: new Date() },
    });
    runIds.push(fresh.id);
    const ok = await GET(request());
    const okBody = (await ok.json()) as {
      ok: boolean;
      freshness: Record<string, { status: string }>;
    };
    expect(okBody.freshness["ops-check"].status).toBe("ok");
    expect(ok.status).toBe(200);

    await db.job.create({
      data: {
        type: "collect-sources",
        dedupeKey: `health-${suffix}`,
        runAfter: new Date(Date.now() - 2 * HOUR),
      },
    });
    const lagging = await GET(request());
    expect(lagging.status).toBe(503);
    const body = (await lagging.json()) as { queue: { oldestPendingSeconds: number } };
    expect(body.queue.oldestPendingSeconds).toBeGreaterThanOrEqual(2 * 3600);
  });
});
