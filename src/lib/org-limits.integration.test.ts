import { createStreamAction } from "@/app/streams/actions";
import { saveOrgPlanAction } from "@/app/admin/actions";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { getDb } from "@/lib/db/client";
import { resetEnvCache } from "@/lib/env";
import { POST } from "@/app/api/scan/route";
import { ingestScan } from "@/lib/scan/ingest";
import { generateScanToken } from "@/lib/scan/tokens";
import { assertMemberCapacity, createLimitedStream, OrgLimitError } from "./org-limits";
import type { PlanId } from "./plans";
import { uploadRepos } from "@scan/upload";
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
  beforeEach(() => {
    vi.stubEnv("BRIFF_CLOUD", "true");
    resetEnvCache();
  });
  afterAll(async () => {
    await db.org.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
    await getDb().$disconnect();
    vi.unstubAllEnvs();
    resetEnvCache();
  });
  const payload = (name: string) => ({
    source: "local" as const,
    repos: [{ name, ecosystem: "npm" as const, dependencies: [] }],
  });
  /** An org on `plan` holding `repos` repos and `streams` streams. */
  async function orgWith(name: string, plan: PlanId, repos: number, streams: number) {
    const org = await db.org.create({ data: { name, plan } });
    ids.push(org.id);
    const scoped = withOrg(db, org.id);
    await scoped.repo.createMany({
      data: Array.from({ length: repos }, (_, i) => ({
        orgId: org.id,
        name: `${name}/r${i}`,
        source: "local" as const,
      })),
    });
    for (let i = 0; i < streams; i++)
      await scoped.bulletinStream.create({ data: { orgId: org.id, name: `S${i}`, slug: `s${i}` } });
    return org.id;
  }

  it("enforces limits in concurrent scan and stream writes, while allowing existing repo updates", async () => {
    // Free: 10 repos, 2 streams. One slot left of each.
    const orgId = await orgWith("acme-limits", "free", 9, 1);
    const scans = await Promise.allSettled([
      ingestScan(db, orgId, payload("acme/one")),
      ingestScan(db, orgId, payload("acme/two")),
    ]);
    expect(scans.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(scans.filter((r) => r.status === "rejected")).toHaveLength(1);
    const scoped = withOrg(db, orgId);
    expect(await scoped.repo.count()).toBe(10);
    await expect(ingestScan(db, orgId, payload("acme-limits/r0"))).resolves.toHaveLength(1);
    const streams = await Promise.allSettled([
      createLimitedStream(db, orgId, "One"),
      createLimitedStream(db, orgId, "Two"),
    ]);
    expect(streams.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await scoped.bulletinStream.count()).toBe(2);
    // Overrides raise the plan's limits; one below the plan changes nothing.
    await db.org.update({ where: { id: orgId }, data: { repoLimit: 11, streamLimit: 1 } });
    await expect(ingestScan(db, orgId, payload("acme/three"))).resolves.toHaveLength(1);
    await expect(createLimitedStream(db, orgId, "Three")).rejects.toThrow(
      "Stream limit reached (2 on the Free plan)"
    );
    vi.stubEnv("DATABASE_URL", url ?? "");
    auth.orgId = orgId;
    const form = new FormData();
    form.set("name", "Blocked");
    const blocked = await createStreamAction({ ok: true, message: null }, form);
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toContain("Stream limit reached (2 on the Free plan)");
    const limits = new FormData();
    limits.set("orgId", orgId);
    limits.set("plan", "pro");
    limits.set("repoLimit", "");
    limits.set("streamLimit", "");
    const saved = await saveOrgPlanAction({ ok: true, message: null }, limits);
    expect(saved).toMatchObject({
      ok: true,
      saved: { plan: "pro", repoLimit: null, streamLimit: null },
    });
    expect(await db.org.findUniqueOrThrow({ where: { id: orgId } })).toMatchObject({
      plan: "pro",
      repoLimit: null,
      streamLimit: null,
      planUpdatedAt: expect.any(Date),
    });
    await expect(createLimitedStream(db, orgId, "Admin raised")).resolves.toBeUndefined();
  });

  it("gives each plan its own limits, and none on a self-hosted instance", async () => {
    const cases: { plan: PlanId; repos: number; streams: number; full: boolean }[] = [
      { plan: "free", repos: 10, streams: 2, full: true },
      { plan: "pro", repos: 50, streams: 10, full: true },
      { plan: "team", repos: 60, streams: 12, full: false },
      { plan: "unlimited", repos: 60, streams: 12, full: false },
    ];
    for (const c of cases) {
      const orgId = await orgWith(`acme-${c.plan}`, c.plan, c.repos, c.streams);
      const scan = () => ingestScan(db, orgId, payload(`acme-${c.plan}/new`));
      const stream = () => createLimitedStream(db, orgId, "Extra");
      if (c.full) {
        await expect(scan(), c.plan).rejects.toThrow("Repository limit reached");
        await expect(stream(), c.plan).rejects.toThrow("Stream limit reached");
      } else {
        await expect(scan(), c.plan).resolves.toHaveLength(1);
        await expect(stream(), c.plan).resolves.toBeUndefined();
      }
    }
    vi.stubEnv("BRIFF_CLOUD", "false");
    resetEnvCache();
    const selfHosted = await orgWith("acme-selfhost", "free", 10, 2);
    await expect(ingestScan(db, selfHosted, payload("acme-selfhost/new"))).resolves.toHaveLength(1);
    await expect(createLimitedStream(db, selfHosted, "Extra")).resolves.toBeUndefined();
    await expect(assertMemberCapacity(selfHosted)).resolves.toBeUndefined();
    auth.orgId = selfHosted;
    const form = new FormData();
    form.set("orgId", selfHosted);
    form.set("plan", "pro");
    expect(await saveOrgPlanAction({ ok: true, message: null }, form)).toMatchObject({ ok: false });
    expect((await db.org.findUniqueOrThrow({ where: { id: selfHosted } })).plan).toBe("free");
  });

  it("counts members against the plan's seats", async () => {
    vi.stubEnv("DATABASE_URL", url ?? "");
    const seats: { plan: PlanId; members: number; full: boolean }[] = [
      { plan: "free", members: 1, full: true },
      { plan: "pro", members: 2, full: false },
      { plan: "pro", members: 3, full: true },
      { plan: "team", members: 10, full: true },
      { plan: "unlimited", members: 12, full: false },
    ];
    for (const [i, c] of seats.entries()) {
      const orgId = await orgWith(`acme-seats-${i}`, c.plan, 0, 0);
      for (let m = 0; m < c.members; m++) {
        const userId = `seat-${i}-${m}-${orgId}`;
        await db.user.create({
          data: { id: userId, name: "seat", email: `${userId}@example.com` },
        });
        await withOrg(db, orgId).orgMember.create({ data: { orgId, userId } });
      }
      const check = assertMemberCapacity(orgId);
      if (c.full) await expect(check, `${c.plan} ${c.members}`).rejects.toThrow(OrgLimitError);
      else await expect(check, `${c.plan} ${c.members}`).resolves.toBeUndefined();
    }
    await db.user.deleteMany({ where: { id: { startsWith: "seat-" } } });
  });
  it("returns a clear API capacity error that the CLI can report", async () => {
    vi.stubEnv("DATABASE_URL", url ?? "");
    vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-test-secret-of-at-least-32-characters");
    vi.stubEnv("BETTER_AUTH_URL", "https://example.com");
    resetEnvCache();
    const org = { id: await orgWith("acme-api-limit", "free", 9, 0) };
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
      "Repository limit reached (10 on the Free plan)"
    );
    expect(await scoped.repo.count()).toBe(10);
    for (const chunk of [1, 2]) {
      const requests: boolean[] = [];
      await expect(
        uploadRepos(
          ["acme/new", "acme/existing"].map((name) => ({
            name,
            path: name,
            ecosystem: "npm" as const,
            dependencies: [{ name: "acme-http", version: `1.0.${chunk}`, direct: true }],
            runtimes: [],
          })),
          {
            apiUrl: "https://example.com",
            token: token.secret,
            source: "local",
            chunk,
            fetch: async (input, init) => {
              requests.push((JSON.parse(String(init.body)) as { final: boolean }).final);
              return POST(new Request(input, init));
            },
          }
        )
      ).rejects.toThrow("Repository limit reached (10 on the Free plan)");
      expect(requests.at(-1)).toBe(true);
      expect(requests).toHaveLength(chunk === 1 ? 2 : 1);
      expect(await scoped.repo.count()).toBe(10);
      expect(await scoped.dependency.findFirstOrThrow()).toMatchObject({
        installedVersion: `1.0.${chunk}`,
      });
    }
  });
});
