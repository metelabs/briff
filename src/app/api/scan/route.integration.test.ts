import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { resetEnvCache } from "@/lib/env";
import { SCAN_DEBOUNCE_MS, SCAN_SESSION_TIMEOUT_MS, scanFollowUpKey } from "@/lib/scan/follow-up";
import type { ScanRepo } from "@/lib/scan/schema";

import { POST } from "./route";

// Runs only when TEST_DATABASE_URL points at a migrated, disposable database.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("POST /api/scan schedules one urgent pass per scan", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  const token = `scan-token-${suffix}-${"x".repeat(24)}`;
  const saved = { ...process.env };
  let orgId = "";

  const repo = (name: string, version: string): ScanRepo => ({
    name,
    ecosystem: "npm",
    dependencies: [],
    runtimes: [{ name: "node", version, normalized: version, source: ".nvmrc" }],
  });
  const upload = (body: Record<string, unknown>) =>
    POST(
      new Request("http://127.0.0.1:3000/api/scan", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ source: "local", ...body }),
      })
    );
  const passes = () =>
    db.job.findMany({
      where: { dedupeKey: scanFollowUpKey(orgId), status: "pending" },
      select: { runAfter: true, payload: true, type: true },
    });

  beforeAll(async () => {
    orgId = (await db.org.create({ data: { name: `scan-${suffix}` } })).id;
    Object.assign(process.env, {
      DATABASE_URL: url,
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "https://app.example.com/",
      NODE_ENV: "test",
      SCANNER_TOKEN: token,
      SCANNER_ORG_ID: orgId,
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

  it("holds the pass while a session uploads and starts it with the final upload", async () => {
    const t0 = Date.now();
    const first = await upload({ scanId: "run-1", final: false, repos: [repo("a", "22")] });
    expect(first.status).toBe(200);
    let [pass] = await passes();
    expect(pass.type).toBe("collect-sources");
    expect(pass.payload).toEqual({ due: true, rematchOrgId: orgId });
    expect(pass.runAfter.getTime()).toBeGreaterThanOrEqual(t0 + SCAN_SESSION_TIMEOUT_MS - 1000);

    await upload({ scanId: "run-1", final: false, repos: [repo("b", "24")] });
    expect(await passes()).toHaveLength(1);

    // The final chunk changes no runtime itself, but releases the held pass.
    await upload({ scanId: "run-1", final: true, repos: [repo("a", "22")] });
    const after = await passes();
    expect(after).toHaveLength(1);
    [pass] = after;
    expect(pass.runAfter.getTime()).toBeLessThanOrEqual(Date.now());
    await db.job.deleteMany({ where: { dedupeKey: scanFollowUpKey(orgId) } });
  });

  it("schedules a pass for a final upload even when no runtime changed", async () => {
    // Reconciliation compares state: a repo an earlier pass missed is caught by any completed scan.
    await upload({ scanId: "run-2", final: true, repos: [repo("a", "22")] });
    const [pass] = await passes();
    expect(pass.runAfter.getTime()).toBeLessThanOrEqual(Date.now());
    await db.job.deleteMany({ where: { dedupeKey: scanFollowUpKey(orgId) } });
  });

  it("debounces an older scanner's uploads into one pass two minutes after the last", async () => {
    await upload({ repos: [repo("c", "20")] });
    const [first] = await passes();
    await upload({ repos: [repo("d", "18")] });
    const all = await passes();
    expect(all).toHaveLength(1);
    expect(all[0].runAfter.getTime()).toBeGreaterThanOrEqual(first.runAfter.getTime());
    expect(all[0].runAfter.getTime()).toBeGreaterThan(Date.now() + SCAN_DEBOUNCE_MS - 5000);
    // Nothing ran the rematch inline: no match rows were written by the uploads.
    expect(await withOrg(db, orgId).itemMatch.count()).toBe(0);
  });
});
