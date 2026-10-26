import { readFileSync } from "node:fs";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it, vi } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { resetEnvCache } from "@/lib/env";
import { log } from "@/lib/log";
import { ingestScan } from "@/lib/scan/ingest";
import { collectFromFiles } from "@scan/collect";

import { securityScan } from "./scan";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("workflow upload through the real security scan", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  let orgId = "";
  const suffix = Date.now().toString(36);
  const pkg = `acme/action-${suffix}`;
  const osvId = `GHSA-acme-${suffix}`;
  afterAll(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetEnvCache();
    if (orgId) await db.org.delete({ where: { id: orgId } });
    await db.package.deleteMany({ where: { name: pkg } });
    await db.$disconnect();
  });

  it("retains constraints and SHA evidence, creates one advisory alert and keeps delivery idempotent", async () => {
    vi.stubEnv("DATABASE_URL", url ?? "");
    vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-test-secret-with-at-least-32-characters");
    vi.stubEnv("BETTER_AUTH_URL", "https://example.com");
    vi.stubEnv("SMTP_HOST", "");
    resetEnvCache();
    const recorded: unknown = JSON.parse(
      readFileSync(
        new URL("../sources/__fixtures__/github-actions/changed-files.json", import.meta.url),
        "utf8"
      )
    );
    const { osvVulnSchema } = await import("@/sources/osv");
    const vuln = osvVulnSchema.parse(recorded);
    vuln.id = osvId;
    vuln.aliases = [];
    vuln.affected[0].package.name = pkg;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        if (String(input).endsWith("/querybatch")) {
          const body = JSON.parse(String(init?.body)) as {
            queries: { package: { name: string } }[];
          };
          return Response.json({
            results: body.queries.map((q) => ({
              vulns: q.package.name === pkg ? [{ id: osvId, modified: vuln.modified }] : [],
            })),
          });
        }
        if (String(input).endsWith(`/vulns/${osvId}`)) return Response.json(vuln);
        throw new Error("Unexpected external request");
      })
    );
    orgId = (await db.org.create({ data: { name: `acme-${suffix}` } })).id;
    const sha = "a".repeat(40);
    const repo = await collectFromFiles(
      `acme/web-${suffix}`,
      {
        ".github/workflows/check.yml": `jobs:\n  check:\n    steps:\n      - uses: ${pkg}@v45\n      - uses: ${pkg}@${sha} # v45.0.7`,
      },
      { warn: () => undefined }
    );
    expect(repo).not.toBeNull();
    if (!repo) throw new Error("Missing workflow payload");
    await ingestScan(db, orgId, { source: "github", repos: [repo] });
    const scoped = withOrg(db, orgId);
    await scoped.repo.updateMany({ data: { included: true } });
    expect(await scoped.dependency.findFirst({ where: { constraint: true } })).toMatchObject({
      installedVersion: "v45",
    });
    expect(await scoped.dependency.findFirst({ where: { constraint: false } })).toMatchObject({
      metadata: { sha, ref: sha },
    });
    const context = {
      db,
      log,
      jobId: "actions-test",
      payload: {},
      heartbeat: async () => undefined,
    };
    await securityScan(context);
    await securityScan(context);
    expect(await scoped.alert.count()).toBe(1);
    expect(await scoped.alert.findFirst()).toMatchObject({ kind: "backlog", deliveredAt: null });
  });
});
