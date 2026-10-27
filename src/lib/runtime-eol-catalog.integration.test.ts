import { withOrg } from "@/lib/db/with-org";
import { prepareStream, storeBulletin, synthesisRequest } from "@/pipeline/weekly";
import { createFakeLlm } from "@/llm/fake";
import { loadPrompt } from "@/llm/prompts";
import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it, vi } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { log } from "@/lib/log";
import { endOfLifeDate, setLifecycleRows } from "./runtime-eol";
import { refreshRuntimeLifecycle, loadRuntimeLifecycle } from "./runtime-eol-catalog";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("persisted runtime lifecycle", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  afterAll(async () => {
    vi.unstubAllGlobals();
    setLifecycleRows([]);
    await db.runtimeLifecycle.deleteMany();
    await db.$disconnect();
  });
  it("refreshes the real job, loads persisted dates and retains data after a failed product fetch", async () => {
    const recorded: unknown = JSON.parse(
      readFileSync(new URL("./__fixtures__/runtime-eol/nodejs.json", import.meta.url), "utf8")
    );
    const heartbeat = vi.fn(async () => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(recorded))
    );
    const ctx = { db, log, heartbeat, jobId: "lifecycle-test", payload: {} };
    const result = await refreshRuntimeLifecycle(ctx);
    expect(result.counts?.products).toBe(17);
    expect(heartbeat).toHaveBeenCalledTimes(17);
    setLifecycleRows([]);
    await loadRuntimeLifecycle(db);
    expect(endOfLifeDate("node", "22")).toBe("2027-04-30");
    const org = await db.org.create({ data: { name: "acme-lifecycle" } });
    try {
      const scoped = withOrg(db, org.id);
      const repo = await scoped.repo.create({
        data: { orgId: org.id, name: "acme/web", source: "local", included: true },
      });
      const stream = await scoped.bulletinStream.create({
        data: { orgId: org.id, name: "Weekly", slug: "weekly" },
      });
      await scoped.repoRuntime.create({
        data: {
          orgId: org.id,
          repoId: repo.id,
          name: "node",
          version: "22.23.4",
          normalized: "22.23.4",
          source: ".nvmrc",
        },
      });
      const prompt = loadPrompt("synthesis");
      const now = new Date("2027-03-01T12:00:00Z");
      const context = {
        now,
        weekStart: now,
        week: "W09",
        language: "en" as const,
        model: "synthetic",
        promptVersion: prompt.version,
      };
      const prepared = await prepareStream(
        db,
        org.id,
        { id: stream.id, name: stream.name, repoIds: [repo.id] },
        context
      );
      expect(prepared?.eolFacts).toEqual([
        "acme/web: node 22 — EOL in 60 days (EOL on 2027-04-30).",
      ]);
      if (!prepared) throw new Error("Missing fact-only bulletin");
      const result = await createFakeLlm().json(
        synthesisRequest(prepared, context.model, prompt.text)
      );
      const stored = await storeBulletin(db, prepared, result, context, { kind: "weekly" });
      const bulletin = await scoped.bulletin.findFirstOrThrow({ where: { id: stored.bulletinId } });
      expect(bulletin.summary).toContain("EOL in 60 days");
    } finally {
      await db.org.delete({ where: { id: org.id } });
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) =>
        String(input).includes("nodejs") ? Response.json([]) : Response.json(recorded)
      )
    );
    const retried = await refreshRuntimeLifecycle(ctx);
    expect(retried.counts?.errors).toBe(1);
    expect(endOfLifeDate("node", "22")).toBe("2027-04-30");
    expect(await db.runtimeLifecycle.count({ where: { product: "node" } })).toBeGreaterThan(0);
  });
});
