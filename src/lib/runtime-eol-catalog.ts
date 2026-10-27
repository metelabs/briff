import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import { fetchJson } from "@/lib/platforms/fetch-with-retry";
import { JobLockLostError } from "@/lib/jobs/queue";
import type { JobContext, JobResult } from "@/worker/types";

import { setLifecycleRows, type LifecycleRow } from "./runtime-eol";

export const EOL_PRODUCTS: Readonly<Record<string, string>> = {
  node: "nodejs",
  php: "php",
  python: "python",
  go: "go",
  ruby: "ruby",
  java: "eclipse-temurin",
  dotnet: "dotnet",
  deno: "deno",
  bun: "bun",
  postgres: "postgresql",
  mysql: "mysql",
  mariadb: "mariadb",
  redis: "redis",
  nginx: "nginx",
  debian: "debian",
  ubuntu: "ubuntu",
  alpine: "alpine-linux",
};

const dateOrBoolean = z.union([z.boolean(), z.iso.date()]);
export const lifecycleApiSchema = z
  .array(
    z.object({
      cycle: z.string().regex(/^\d+(?:\.\d+)*$/),
      eol: dateOrBoolean,
      latest: z.string().optional(),
      lts: dateOrBoolean.optional(),
      support: dateOrBoolean.optional(),
      extendedSupport: dateOrBoolean.optional(),
    })
  )
  .min(1);

export function lifecycleRows(product: string, input: unknown): LifecycleRow[] {
  const rows = lifecycleApiSchema.parse(input).map((row) => ({
    product,
    cycle: row.cycle,
    // The API EOL includes Debian public LTS; extendedSupport is paid ELTS.
    eol: row.eol,
    latest: row.latest ?? null,
    lts: row.lts ?? null,
    support: row.support ?? null,
  }));
  if (new Set(rows.map((row) => row.cycle)).size !== rows.length)
    throw new Error("Duplicate lifecycle cycle");
  return rows;
}

export async function loadRuntimeLifecycle(db: PrismaClient): Promise<void> {
  const rows = await db.runtimeLifecycle.findMany();
  const parsed = rows.map((row): LifecycleRow => ({
    product: row.product,
    cycle: row.cycle,
    eol: dateOrBoolean.parse(row.eol),
    latest: row.latest,
    lts: row.lts === null ? null : dateOrBoolean.parse(row.lts),
    support: row.support === null ? null : dateOrBoolean.parse(row.support),
  }));
  setLifecycleRows(parsed);
}

export async function refreshRuntimeLifecycle({
  db,
  log,
  heartbeat,
}: JobContext): Promise<JobResult> {
  const counts = { products: 0, cycles: 0, errors: 0 };
  for (const [product, apiProduct] of Object.entries(EOL_PRODUCTS)) {
    await heartbeat();
    try {
      const input = await fetchJson(
        "runtime-eol",
        `https://endoflife.date/api/${apiProduct}.json`,
        lifecycleApiSchema,
        { timeoutMs: 30_000 }
      );
      const rows = lifecycleRows(product, input);
      await db.$transaction(async (tx) => {
        await tx.runtimeLifecycle.deleteMany({ where: { product } });
        await tx.runtimeLifecycle.createMany({
          data: rows.map((row) => ({
            ...row,
            lts: row.lts ?? undefined,
            support: row.support ?? undefined,
            fetchedAt: new Date(),
          })),
        });
      });
      counts.products++;
      counts.cycles += rows.length;
    } catch (err) {
      if (err instanceof JobLockLostError) throw err;
      counts.errors++;
      log.warn({ err, product }, "runtime lifecycle: retaining previous product data");
    }
  }
  await loadRuntimeLifecycle(db);
  if (!counts.products) throw new Error("All runtime lifecycle fetches failed");
  return { counts };
}
