import { createStreamAction } from "@/app/streams/actions";
import { raiseOrgLimitsAction } from "@/app/admin/actions";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { getDb } from "@/lib/db/client";
import { resetEnvCache } from "@/lib/env";
import { POST } from "@/app/api/scan/route";
import { ingestScan } from "@/lib/scan/ingest";
import { generateScanToken } from "@/lib/scan/tokens";
import { createLimitedStream } from "./org-limits";
const auth = vi.hoisted(() => ({ orgId: "" }));
vi.mock("@/lib/auth/session", () => ({
  requireOrgContext: async () => ({ orgId: auth.orgId }),
  requireAdminContext: async () => ({ orgId: auth.orgId }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("organisation capacity", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const ids: string[] = [];
  afterAll(async () => {
    await db.org.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
    await getDb().$disconnect();
    vi.unstubAllEnvs();
    resetEnvCache();
  });
  it("enforces limits in concurrent scan and stream writes, while allowing existing repo updates", async () => {
    const org = await db.org.create({
      data: { name: "acme-limits", repoLimit: 1, streamLimit: 1 },
    });
    ids.push(org.id);
    const payload = (name: string) => ({
      source: "local" as const,
      repos: [{ name, ecosystem: "npm" as const, dependencies: [] }],
    });
    const scans = await Promise.allSettled([
      ingestScan(db, org.id, payload("acme/one")),
      ingestScan(db, org.id, payload("acme/two")),
    ]);
    expect(scans.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(scans.filter((r) => r.status === "rejected")).toHaveLength(1);
    const scoped = withOrg(db, org.id);
    const repo = await scoped.repo.findFirstOrThrow();
    await expect(ingestScan(db, org.id, payload(repo.name))).resolves.toHaveLength(1);
    const streams = await Promise.allSettled([
      createLimitedStream(db, org.id, "One"),
      createLimitedStream(db, org.id, "Two"),
    ]);
    expect(streams.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await scoped.bulletinStream.count()).toBe(1);
    await db.org.update({ where: { id: org.id }, data: { repoLimit: 2, streamLimit: 2 } });
    await expect(ingestScan(db, org.id, payload("acme/three"))).resolves.toHaveLength(1);
    await expect(createLimitedStream(db, org.id, "Three")).resolves.toBeUndefined();
    vi.stubEnv("DATABASE_URL", url ?? "");
    auth.orgId = org.id;
    const form = new FormData();
    form.set("name", "Blocked");
    const blocked = await createStreamAction({ ok: true, message: null }, form);
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toContain("Stream limit reached (2)");
    const limits = new FormData();
    limits.set("orgId", org.id);
    limits.set("repoLimit", "3");
    limits.set("streamLimit", "3");
    expect((await raiseOrgLimitsAction({ ok: true, message: null }, limits)).ok).toBe(true);
    await expect(createLimitedStream(db, org.id, "Admin raised")).resolves.toBeUndefined();
  });
  it("returns a clear API capacity error that the CLI can report", async () => {
    vi.stubEnv("DATABASE_URL", url ?? "");
    vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-test-secret-of-at-least-32-characters");
    vi.stubEnv("BETTER_AUTH_URL", "https://example.com");
    resetEnvCache();
    const org = await db.org.create({ data: { name: "acme-api-limit", repoLimit: 1 } });
    ids.push(org.id);
    const scoped = withOrg(db, org.id);
    await scoped.repo.create({ data: { orgId: org.id, name: "acme/existing", source: "local" } });
    const token = generateScanToken();
    await scoped.scanToken.create({
      data: { orgId: org.id, name: "synthetic", tokenHash: token.tokenHash, prefix: token.prefix },
    });
    const res = await POST(
      new Request("https://example.com/api/scan", {
        method: "POST",
        headers: { Authorization: `Bearer ${token.secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "local",
          repos: [{ name: "acme/new", ecosystem: "npm", dependencies: [] }],
        }),
      })
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain(
      "Repository limit reached (1)"
    );
    expect(await scoped.repo.count()).toBe(1);
  });
});
