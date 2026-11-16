import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { resetEnvCache } from "@/lib/env";
import { log } from "@/lib/log";

// A manual stack end to end against Postgres: the save action (owner check, limits, tenant
// isolation, onboarding), the rows the pipeline reads, OSV queries, and per-stream cadence.

const session = vi.hoisted(() => ({ orgId: "", userId: "" }));
const testDb = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/auth/session", () => ({
  requireOrgContext: async () => ({ email: "u@example.com", name: "u", ...session }),
}));
vi.mock("@/lib/db/client", () => ({ getDb: () => testDb.client }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/email/mailer", () => ({
  smtpConfig: () => null,
  sendMail: async () => ({ status: "skipped" }),
}));

const { saveStackAction, deleteStackAction } = await import("@/app/stack/actions");
const { createOrgForUser } = await import("@/lib/org");
const { loadOrgStacks } = await import("@/lib/match/stack");
const { securityScan } = await import("@/security/scan");
const { weeklyBulletin } = await import("@/pipeline/weekly");
const { SECURITY_ALERT_REPOS } = await import("@/lib/streams");

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("manual stacks against Postgres", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  testDb.client = db;
  const suffix = Date.now().toString(36);
  const saved = { ...process.env };
  const users: string[] = [];
  const orgs: string[] = [];
  const osvQueries: { package: { ecosystem: string; name: string }; version?: string }[] = [];
  const sourceIds: string[] = [];
  let ownerId = "";
  let memberId = "";
  let orgId = "";
  let otherOrgId = "";

  async function user(tag: string): Promise<string> {
    const id = `ms-${tag}-${suffix}`;
    await db.user.create({
      data: { id, name: tag, email: `${tag}-${suffix}@example.com`, emailVerified: true },
    });
    users.push(id);
    return id;
  }

  const as = (userId: string, org: string) => Object.assign(session, { userId, orgId: org });

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: url,
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "http://127.0.0.1:3000",
      BRIFF_CLOUD: "true",
      BRIFF_LLM_FAKE: "true",
      BRIFF_LLM_BATCH: "false",
      NODE_ENV: "test",
    });
    resetEnvCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        if (String(input).endsWith("/querybatch")) {
          const body = JSON.parse(String(init?.body)) as { queries: typeof osvQueries };
          osvQueries.push(...body.queries);
          return Response.json({ results: body.queries.map(() => ({})) });
        }
        return new Response(null, { status: 404 });
      })
    );
    ownerId = await user("owner");
    memberId = await user("member");
    orgId = await createOrgForUser(db, { name: `ms-${suffix}`, userId: ownerId });
    await withOrg(db, orgId).orgMember.create({
      data: { orgId, userId: memberId, role: "member" },
    });
    otherOrgId = await createOrgForUser(db, {
      name: `ms-other-${suffix}`,
      userId: await user("other"),
    });
    orgs.push(orgId, otherOrgId);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await db.org.deleteMany({ where: { id: { in: orgs } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.source.deleteMany({ where: { id: { in: sourceIds } } });
    await db.$disconnect();
    process.env = saved;
    resetEnvCache();
  });

  let stackId = "";

  it("onboarding: creates the stack in the default stream with the chosen cadence", async () => {
    as(ownerId, orgId);
    const res = await saveStackAction({
      stackId: null,
      name: "Agency stack",
      onboarding: "both",
      items: [
        { kind: "runtime", name: "node", version: "22" },
        { kind: "runtime", name: "postgres", version: "16" },
        { kind: "package", ecosystem: "npm", name: "react" },
        { kind: "package", ecosystem: "npm", name: "next", version: "15.2.3" },
        { kind: "tool", name: "Dokploy/dokploy" },
      ],
    });
    expect(res).toMatchObject({ ok: true, message: "Created “Agency stack”." });
    stackId = res.id ?? "";
    const scoped = withOrg(db, orgId);
    const repo = await scoped.repo.findFirstOrThrow({
      where: { id: stackId },
      select: {
        source: true,
        path: true,
        included: true,
        streams: {
          select: {
            stream: { select: { slug: true, weeklyBulletin: true, securityAlerts: true } },
          },
        },
        runtimes: { select: { name: true, version: true, source: true } },
        dependencies: {
          select: {
            installedVersion: true,
            constraint: true,
            unresolved: true,
            package: { select: { ecosystem: true, name: true } },
          },
        },
      },
    });
    expect(repo).toMatchObject({ source: "manual", path: null, included: true });
    expect(repo.streams).toEqual([
      { stream: { slug: "weekly", weeklyBulletin: true, securityAlerts: true } },
    ]);
    expect(repo.runtimes.map((r) => `${r.name}@${r.version}:${r.source}`).sort()).toEqual([
      "node@22:manual",
      "postgres@16:manual",
    ]);
    expect(
      repo.dependencies
        .map(
          (d) => `${d.package.ecosystem}:${d.package.name}@${d.installedVersion}:${d.unresolved}`
        )
        .sort()
    ).toEqual(["GitHub:Dokploy/dokploy@*:true", "npm:next@15.2.3:false", "npm:react@*:true"]);
    const member = await scoped.orgMember.findFirstOrThrow({
      where: { userId: ownerId },
      select: { onboardedAt: true },
    });
    expect(member.onboardedAt).not.toBeNull();
    const events = await scoped.orgEvent.findMany({ select: { type: true, detail: true } });
    expect(events).toContainEqual({ type: "stack_created", detail: "Agency stack: 5 items" });
  });

  it("the pipeline sees every item; OSV gets only the pinned version", async () => {
    const [stack] = await loadOrgStacks(db, [orgId]);
    expect([...stack.packages.keys()].sort()).toEqual(["GitHub:Dokploy/dokploy", "next", "react"]);
    expect(stack.runtimes.get("node")?.repoIds).toEqual(new Set([stackId]));
    expect(
      [...stack.packagesByFeed.entries()].find(([feed]) => feed.includes("security-advisories"))
    ).toEqual([
      "https://api.github.com/repos/Dokploy/dokploy/security-advisories",
      ["GitHub:Dokploy/dokploy"],
    ]);

    osvQueries.length = 0;
    await securityScan({
      db,
      log,
      jobId: `ms-${suffix}`,
      payload: { orgId, manual: true },
      heartbeat: async () => {},
    });
    const names = osvQueries.map((q) => `${q.package.name}@${q.version ?? ""}`);
    expect(names).toContain("next@15.2.3");
    expect(names.some((n) => n.startsWith("react@") || n.startsWith("Dokploy"))).toBe(false);
  });

  it("bootstraps release and advisory sources for a picked tool", async () => {
    const { refreshPackages } = await import("@/sources/refresh-packages");
    await refreshPackages({
      db,
      log,
      jobId: `ms-r-${suffix}`,
      payload: {},
      heartbeat: async () => {},
    });
    // The releases feed may already be a curated source (Dokploy is); matching goes by URL.
    const urls = [
      "https://github.com/Dokploy/dokploy/releases.atom",
      "https://api.github.com/repos/Dokploy/dokploy/security-advisories",
    ];
    const sources = await db.source.findMany({
      where: { url: { in: urls } },
      select: { id: true, kind: true, url: true, class: true, packageId: true },
      orderBy: { url: "asc" },
    });
    sourceIds.push(...sources.filter((s) => s.packageId !== null).map((s) => s.id));
    expect(sources.map((s) => s.url)).toEqual([...urls].sort());
    const pkg = await db.package.findFirstOrThrow({
      where: { ecosystem: "GitHub", name: "Dokploy/dokploy" },
      select: { id: true, releaseFeedUrl: true },
    });
    expect(pkg.releaseFeedUrl).toBe(urls[0]);
    expect(sources.find((s) => s.url === urls[1])).toMatchObject({
      kind: "github_advisories",
      class: "security",
      packageId: pkg.id,
    });
  });

  it("only owners save or delete, and another org's stack is not found", async () => {
    as(memberId, orgId);
    expect(
      await saveStackAction({
        stackId,
        name: "Agency stack",
        items: [{ kind: "package", ecosystem: "npm", name: "react" }],
      })
    ).toEqual({ ok: false, message: "Only an owner can change stacks." });
    expect(await deleteStackAction(stackId)).toEqual({
      ok: false,
      message: "Only an owner can change stacks.",
    });

    const otherOwner = users[2];
    as(otherOwner, otherOrgId);
    expect(
      await saveStackAction({
        stackId,
        name: "Hijack",
        items: [{ kind: "package", ecosystem: "npm", name: "react" }],
      })
    ).toEqual({ ok: false, message: "That stack does not exist any more." });
    expect(await deleteStackAction(stackId)).toMatchObject({ ok: false });
    expect(await withOrg(db, orgId).dependency.count({ where: { repoId: stackId } })).toBe(3);
  });

  it("enforces the plan's stack item limit across stacks, in the repo limit's words", async () => {
    as(ownerId, orgId);
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        kind: "package" as const,
        ecosystem: "npm",
        name: `limit-pkg-${i}-${suffix}`,
      }));
    // Free: 25 items in all; the first stack has 5.
    expect(
      await saveStackAction({ stackId: null, name: "Second", streamId: null, items: many(21) })
    ).toEqual({
      ok: false,
      message:
        "Stack item limit reached (25 on the Free plan). See Settings → Billing for the plans.",
    });
    const second = await saveStackAction({
      stackId: null,
      name: "Second",
      streamId: null,
      items: many(20),
    });
    expect(second).toMatchObject({ ok: true });
    // Replacing a stack counts its new items, not its old ones.
    expect(
      await saveStackAction({
        stackId: second.id ?? null,
        name: "Second (renamed)",
        items: many(20),
      })
    ).toMatchObject({ ok: true, message: "Saved “Second (renamed)”." });
    expect(
      await saveStackAction({ stackId: null, name: "Second (renamed)", items: many(1) })
    ).toMatchObject({ ok: false, message: "A stack named “Second (renamed)” already exists." });
    const repo = await withOrg(db, orgId).repo.findFirstOrThrow({
      where: { id: second.id },
      select: { included: true, name: true },
    });
    expect(repo).toEqual({ included: false, name: "Second (renamed)" });
    expect(await deleteStackAction(second.id ?? "")).toMatchObject({ ok: true });
  });

  it("security alerts reach a repo only through a stream with them on", async () => {
    const scoped = withOrg(db, orgId);
    const weekly = await scoped.bulletinStream.findFirstOrThrow({ where: { slug: "weekly" } });
    const quiet = await scoped.bulletinStream.create({
      data: { orgId, name: "Quiet", slug: `quiet-${suffix}`, securityAlerts: false },
    });
    await scoped.streamRepo.create({ data: { orgId, streamId: quiet.id, repoId: stackId } });
    const alerting = async () =>
      (await scoped.repo.findMany({ where: SECURITY_ALERT_REPOS, select: { id: true } })).map(
        (r) => r.id
      );
    // In two streams, one with alerts on: alerts still come.
    expect(await alerting()).toEqual([stackId]);
    await scoped.bulletinStream.updateMany({
      where: { id: weekly.id },
      data: { securityAlerts: false },
    });
    expect(await alerting()).toEqual([]);

    // A pending alert of a muted repo is marked delivered without an email.
    const pkg = await db.package.findFirstOrThrow({ where: { ecosystem: "npm", name: "next" } });
    const advisory = await db.advisory.create({
      data: { osvId: `GHSA-ms-${suffix}`, packageId: pkg.id, affected: [] },
    });
    const alert = await scoped.alert.create({
      data: { orgId, advisoryId: advisory.id, repoId: stackId, kind: "new" },
    });
    const run = await securityScan({
      db,
      log,
      jobId: `ms-s-${suffix}`,
      payload: { orgId, manual: true },
      heartbeat: async () => {},
    });
    expect(run.counts).toMatchObject({ alertsSuppressed: 1 });
    expect(
      (await scoped.alert.findFirstOrThrow({ where: { id: alert.id } })).deliveredAt
    ).not.toBeNull();
    await db.advisory.delete({ where: { id: advisory.id } });
  });

  it("a stream with the weekly bulletin off gets no bulletin; one with it on does", async () => {
    const scoped = withOrg(db, orgId);
    const pkg = await db.package.findFirstOrThrow({ where: { ecosystem: "npm", name: "next" } });
    const advisory = await db.advisory.create({
      data: { osvId: `GHSA-ms-w-${suffix}`, packageId: pkg.id, affected: [], severity: "HIGH" },
    });
    await scoped.alert.create({
      data: { orgId, advisoryId: advisory.id, repoId: stackId, kind: "backlog" },
    });
    await scoped.bulletinStream.updateMany({
      where: { slug: "weekly" },
      data: { weeklyBulletin: false, securityAlerts: true },
    });
    await weeklyBulletin({
      db,
      log,
      jobId: `ms-w-${suffix}`,
      payload: {},
      heartbeat: async () => {},
    });
    const bulletins = await scoped.bulletin.findMany({
      select: { stream: { select: { slug: true } } },
    });
    expect(bulletins).toEqual([{ stream: { slug: `quiet-${suffix}` } }]);
    await db.advisory.delete({ where: { id: advisory.id } });
  });
});
