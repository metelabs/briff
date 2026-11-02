import { generateKeyPairSync } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { resetEnvCache } from "@/lib/env";
import { log } from "@/lib/log";
import { acceptScan } from "@/lib/scan/accept";
import { collectRepos } from "@scan/collect";

import type { Http } from "./api";
import type { GithubAppConfig } from "./config";
import {
  findInstallation,
  installationCapacity,
  linkInstallation,
  removeInstallationRepos,
} from "./installations";
import { planAllowance } from "@/lib/plans";
import { scanInstallation, scannedTreeEntries } from "./scan";

// GitHub responses recorded from the public api.github.com for vercel/ms (repo, branch,
// recursive tree, the scanned blobs); the token and the installation's repo
// list are shaped like the API's (there is no app to record them from).
const FIXTURES = path.join(__dirname, "__fixtures__", "vercel-ms");
const json = (name: string) => JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8"));
const repo = json("repo.json");
const branch = json("branch.json");
const tree = json("tree.json");
const blobs = new Map(
  readdirSync(FIXTURES)
    .filter((f) => f.startsWith("blob-"))
    .map((f) => [f.slice(5, -4), readFileSync(path.join(FIXTURES, f), "utf8")])
);

function fakeGithub(
  requests: string[],
  override?: (path: string, url: URL) => Response | null
): Http {
  return async (url, init) => {
    const u = new URL(url);
    requests.push(`${init?.method ?? "GET"} ${u.pathname}`);
    const special = override?.(u.pathname, u);
    if (special) return special;
    const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (u.pathname.endsWith("/access_tokens"))
      return ok({ token: "ghs_test", expires_at: new Date(Date.now() + 3600_000).toISOString() });
    if (u.pathname === "/installation/repositories")
      return ok({ total_count: 1, repositories: [repo] });
    if (u.pathname === "/repos/vercel/ms") return ok(repo);
    if (u.pathname === "/repos/vercel/ms/branches/main") return ok(branch);
    if (u.pathname === `/repos/vercel/ms/git/trees/${tree.sha}`) return ok(tree);
    const blob = /\/repos\/vercel\/ms\/git\/blobs\/([0-9a-f]{40})$/.exec(u.pathname);
    if (blob && blobs.has(blob[1])) return new Response(blobs.get(blob[1]), { status: 200 });
    return new Response("{}", { status: 404 });
  };
}

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("GitHub App scan against Postgres", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  const orgs: string[] = [];
  const config: GithubAppConfig = {
    appId: "1",
    slug: "briff-test",
    privateKey: generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
      type: "pkcs8",
      format: "pem",
    }) as string,
    webhookSecret: "w",
    clientId: "c",
    clientSecret: "s",
  };
  let dir = "";

  beforeAll(async () => {
    for (const name of ["cli", "app"]) {
      orgs.push((await db.org.create({ data: { name: `${name}-${suffix}` } })).id);
    }
    // The CLI's view: a checkout with the same scanned files.
    dir = await mkdtemp(path.join(tmpdir(), "briff-ms-"));
    for (const entry of scannedTreeEntries(tree)) {
      await mkdir(path.dirname(path.join(dir, entry.path)), { recursive: true });
      await writeFile(path.join(dir, entry.path), blobs.get(entry.sha) ?? "");
    }
  });

  afterAll(async () => {
    await db.org.deleteMany({ where: { id: { in: orgs } } });
    await db.$disconnect();
    await rm(dir, { recursive: true, force: true });
  });

  async function record(orgId: string) {
    const r = await withOrg(db, orgId).repo.findFirstOrThrow({
      where: { source: "github", name: "vercel/ms" },
      select: {
        name: true,
        path: true,
        ecosystem: true,
        dependencies: {
          select: { installedVersion: true, direct: true, package: { select: { name: true } } },
          orderBy: [{ package: { name: "asc" } }, { installedVersion: "asc" }],
        },
        runtimes: {
          select: { name: true, version: true, normalized: true, source: true, constraint: true },
          orderBy: [{ name: "asc" }, { source: "asc" }],
        },
      },
    });
    return r;
  }

  it("leaves over-limit GitHub repositories unlinked and records a Repos notice", async () => {
    vi.stubEnv("BRIFF_CLOUD", "true");
    resetEnvCache();
    const org = await db.org.create({ data: { name: "acme-capacity" } });
    orgs.push(org.id);
    const scoped = withOrg(db, org.id);
    // Free plan: 10 repos, all taken.
    await scoped.repo.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        orgId: org.id,
        name: `acme/existing-${i}`,
        source: "local" as const,
      })),
    });
    const installationId = `7${Date.now()}`.slice(0, 12);
    await linkInstallation(db, {
      orgId: org.id,
      installationId,
      accountLogin: "acme",
      accountType: "Organization",
      suspendedAt: null,
    });
    const result = await scanInstallation({
      db,
      http: fakeGithub([]),
      config,
      payload: { installationId },
      scanId: "capacity",
      log,
      heartbeat: async () => undefined,
    });
    if (!("counts" in result)) throw new Error("Unexpected skip");
    expect(result.counts.repoLimitSkipped).toBe(1);
    expect(result.counts.ingested).toBe(0);
    expect(await scoped.repo.count()).toBe(10);
    expect(await scoped.repo.count({ where: { githubInstallationId: { not: null } } })).toBe(0);
    expect((await db.org.findUniqueOrThrow({ where: { id: org.id } })).githubRepoLimitReached).toBe(
      true
    );
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("fetches only the scanned blobs and stores the same repo record as the CLI upload", async () => {
    const [cliOrg, appOrg] = orgs;
    const [cliPayload] = await collectRepos(
      dir,
      { kind: "single", repoName: "vercel/ms" },
      {
        warn: () => {},
      }
    );
    await acceptScan(db, cliOrg, {
      source: "github",
      repos: [cliPayload],
      scanId: "cli",
      final: true,
    });

    await linkInstallation(db, {
      orgId: appOrg,
      installationId: `9${Date.now()}`.slice(0, 12),
      accountLogin: "vercel",
      accountType: "Organization",
      suspendedAt: null,
    });
    const installationId = (
      await withOrg(db, appOrg).githubInstallation.findFirstOrThrow({
        select: { installationId: true },
      })
    ).installationId;
    const requests: string[] = [];
    const result = await scanInstallation({
      db,
      http: fakeGithub(requests),
      config,
      payload: { installationId },
      scanId: "app",
      log,
      heartbeat: async () => {},
    });
    expect(result).toMatchObject({ counts: { repos: 1, ingested: 1, filesFetched: 5 } });
    // Paths only from the tree; contents only for manifests, lockfiles and workflow uses.
    expect(requests.filter((r) => r.includes("/git/blobs/"))).toHaveLength(5);
    expect(requests.some((r) => r.includes("tarball") || r.includes("zipball"))).toBe(false);

    const cli = await record(cliOrg);
    const app = await record(appOrg);
    expect(app).toEqual(cli);
    expect(app.dependencies.length).toBeGreaterThan(10);

    // Unchanged head: nothing fetched beyond the branch.
    const again: string[] = [];
    const second = await scanInstallation({
      db,
      http: fakeGithub(again),
      config,
      payload: { installationId },
      scanId: "app-2",
      log,
      heartbeat: async () => {},
    });
    expect(second).toMatchObject({ counts: { unchanged: 1, ingested: 0 } });
    expect(again.some((r) => r.includes("/git/"))).toBe(false);
  });

  it("is the same record as an Action upload of the repo, and removal only takes app repos", async () => {
    const [cliOrg] = orgs;
    // The Action uploaded vercel/ms into cliOrg; installing the app there reuses that record.
    await linkInstallation(db, {
      orgId: cliOrg,
      installationId: `8${Date.now()}`.slice(0, 12),
      accountLogin: "vercel",
      accountType: "Organization",
      suspendedAt: null,
    });
    const inst = await withOrg(db, cliOrg).githubInstallation.findFirstOrThrow({
      select: { installationId: true },
    });
    const row = await findInstallation(db, inst.installationId);
    // Not brought in by the app yet: removal leaves it.
    expect(await removeInstallationRepos(db, row!, ["vercel/ms"])).toEqual([]);
    await scanInstallation({
      db,
      http: fakeGithub([]),
      config,
      payload: { installationId: inst.installationId, repos: ["vercel/ms"], force: true },
      scanId: "app-3",
      log,
      heartbeat: async () => {},
    });
    expect(await withOrg(db, cliOrg).repo.count({ where: { name: "vercel/ms" } })).toBe(1);
    expect(await removeInstallationRepos(db, row!, ["vercel/ms"])).toEqual(["vercel/ms"]);
    expect(await withOrg(db, cliOrg).repo.count({ where: { name: "vercel/ms" } })).toBe(0);
  });

  async function freshInstallation(orgId: string, prefix: string): Promise<string> {
    const installationId = `${prefix}${Date.now()}`.slice(0, 12);
    await linkInstallation(db, {
      orgId,
      installationId,
      accountLogin: "vercel",
      accountType: "Organization",
      suspendedAt: null,
    });
    return installationId;
  }
  const followUps = (installationId: string) =>
    db.job.findMany({
      where: {
        type: "github-scan",
        status: "pending",
        dedupeKey: { startsWith: `github-scan:${installationId}:` },
      },
      select: { payload: true, runAfter: true },
    });

  it("stores an empty snapshot when a known repo no longer has scanned files", async () => {
    const orgId = (await db.org.create({ data: { name: `empty-${suffix}` } })).id;
    orgs.push(orgId);
    const installationId = await freshInstallation(orgId, "6");
    const run = (http: Http) =>
      scanInstallation({
        db,
        http,
        config,
        payload: { installationId, force: true },
        scanId: "e",
        log,
        heartbeat: async () => {},
      });
    await run(fakeGithub([]));
    expect((await record(orgId)).dependencies.length).toBeGreaterThan(10);
    const bare = {
      ...tree,
      tree: tree.tree.filter(
        (e: { path: string }) =>
          !["package.json", "pnpm-lock.yaml"].includes(e.path) &&
          !e.path.startsWith(".github/workflows/")
      ),
    };
    const res = await run(
      fakeGithub([], (p) => (p.includes("/git/trees/") ? new Response(JSON.stringify(bare)) : null))
    );
    expect(res).toMatchObject({ counts: { emptied: 1, ingested: 1 } });
    expect(await record(orgId)).toMatchObject({ dependencies: [], runtimes: [] });
  });

  it("keeps what it read and defers the rest to GitHub's reset time on a rate limit", async () => {
    const orgId = (await db.org.create({ data: { name: `rl-${suffix}` } })).id;
    orgs.push(orgId);
    const installationId = await freshInstallation(orgId, "3");
    const reset = Math.floor(Date.now() / 1000) + 3600;
    const res = await scanInstallation({
      db,
      http: fakeGithub([], (p) =>
        p.endsWith("/branches/main")
          ? new Response("{}", {
              status: 403,
              headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) },
            })
          : null
      ),
      config,
      payload: { installationId, force: true },
      scanId: "rl",
      log,
      heartbeat: async () => {},
    });
    expect(res).toMatchObject({ counts: { rateLimited: 1, ingested: 0 } });
    const jobs = await followUps(installationId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toMatchObject({ installationId, repos: ["vercel/ms"], force: true });
    expect(jobs[0].runAfter.getTime()).toBe(reset * 1000);
    await db.job.deleteMany({
      where: { dedupeKey: { startsWith: `github-scan:${installationId}:` } },
    });
  });

  it("keeps the stored snapshot when a file fails to parse", async () => {
    const orgId = (await db.org.create({ data: { name: `partial-${suffix}` } })).id;
    orgs.push(orgId);
    const installationId = await freshInstallation(orgId, "4");
    const run = (http: Http) =>
      scanInstallation({
        db,
        http,
        config,
        payload: { installationId, force: true },
        scanId: "p",
        log,
        heartbeat: async () => {},
      });
    await run(fakeGithub([]));
    const before = await record(orgId);
    const lockSha = tree.tree.find((e: { path: string }) => e.path === "pnpm-lock.yaml").sha;
    const res = await run(
      fakeGithub([], (p) => (p.endsWith(lockSha) ? new Response(": not yaml: [") : null))
    );
    expect(res).toMatchObject({ counts: { partial: 1, ingested: 0 } });
    expect(await record(orgId)).toEqual(before);
  });

  it("splits a deferred list longer than one payload allows", async () => {
    const orgId = (await db.org.create({ data: { name: `many-${suffix}` } })).id;
    orgs.push(orgId);
    const installationId = await freshInstallation(orgId, "1");
    const many = Array.from({ length: 1500 }, (_, i) => ({ ...repo, full_name: `acme/r${i}` }));
    await scanInstallation({
      db,
      http: fakeGithub([], (p, u) => {
        if (p === "/installation/repositories") {
          const page = Number(u.searchParams.get("page"));
          return new Response(
            JSON.stringify({
              total_count: many.length,
              repositories: many.slice((page - 1) * 100, page * 100),
            })
          );
        }
        return p.includes("/branches/")
          ? new Response("{}", { status: 429, headers: { "retry-after": "60" } })
          : null;
      }),
      config,
      payload: { installationId },
      scanId: "many",
      log,
      heartbeat: async () => {},
    });
    const jobs = await followUps(installationId);
    expect(jobs.map((j) => ((j.payload as { repos: string[] }).repos ?? []).length).sort()).toEqual(
      [1000, 500]
    );
    await db.job.deleteMany({
      where: { dedupeKey: { startsWith: `github-scan:${installationId}:` } },
    });
  });

  it("skips an inaccessible repo in an explicit list and scans the rest", async () => {
    const orgId = (await db.org.create({ data: { name: `gone-${suffix}` } })).id;
    orgs.push(orgId);
    const installationId = await freshInstallation(orgId, "9");
    const res = await scanInstallation({
      db,
      http: fakeGithub([]),
      config,
      payload: { installationId, repos: ["acme/deleted", "vercel/ms"], force: true },
      scanId: "gone",
      log,
      heartbeat: async () => {},
    });
    expect(res).toMatchObject({ counts: { inaccessible: 1, ingested: 1, repoErrors: 0 } });
    expect(await followUps(installationId)).toHaveLength(0);
  });

  it("queues a bounded retry for repos that failed", async () => {
    const orgId = (await db.org.create({ data: { name: `retry-${suffix}` } })).id;
    orgs.push(orgId);
    const installationId = await freshInstallation(orgId, "2");
    const failing = fakeGithub([], (p) =>
      p.includes("/git/trees/") ? new Response("{}", { status: 502 }) : null
    );
    const run = (retry?: number) =>
      scanInstallation({
        db,
        http: failing,
        config,
        payload: { installationId, force: true, ...(retry ? { retry } : {}) },
        scanId: "r",
        log,
        heartbeat: async () => {},
      });
    expect(await run()).toMatchObject({ counts: { repoErrors: 1, retriesQueued: 1 } });
    expect((await followUps(installationId))[0].payload).toMatchObject({
      repos: ["vercel/ms"],
      retry: 1,
    });
    await db.job.deleteMany({
      where: { dedupeKey: { startsWith: `github-scan:${installationId}:` } },
    });
    expect(await run(3)).toMatchObject({ counts: { repoErrors: 1, retriesQueued: 0 } });
    expect(await followUps(installationId)).toHaveLength(0);
  });

  it("links an installation to one org only", async () => {
    const [cliOrg, appOrg] = orgs;
    const installationId = `7${Date.now()}`.slice(0, 12);
    const args = { installationId, accountLogin: "x", accountType: "User", suspendedAt: null };
    expect(await linkInstallation(db, { ...args, orgId: appOrg })).toBe("linked");
    expect(await linkInstallation(db, { ...args, orgId: appOrg })).toBe("already-linked");
    expect(await linkInstallation(db, { ...args, orgId: cliOrg })).toBe("other-org");
  });

  it("refuses a new installation past the plan's limit, never a relink", async () => {
    const orgId = (await db.org.create({ data: { name: "install-limit", plan: "free" } })).id;
    try {
      const base = `8${Date.now()}`.slice(0, 11);
      const args = { accountLogin: "x", accountType: "User", suspendedAt: null, orgId };
      const limit = planAllowance("free", "githubInstallations", { cloud: true });
      expect(limit).toBe(1);
      expect(await linkInstallation(db, { ...args, installationId: `${base}1`, limit })).toBe(
        "linked"
      );
      // Two parallel setups for new installations: the lock lets neither pass the limit.
      expect(
        await Promise.all([
          linkInstallation(db, { ...args, installationId: `${base}2`, limit }),
          linkInstallation(db, { ...args, installationId: `${base}3`, limit }),
        ])
      ).toEqual(["at-limit", "at-limit"]);
      expect(await linkInstallation(db, { ...args, installationId: `${base}1`, limit })).toBe(
        "already-linked"
      );
      expect(await installationCapacity(db, orgId, true)).toEqual({
        used: 1,
        limit: 1,
        plan: "free",
      });
      expect(await installationCapacity(db, orgId, false)).toMatchObject({ limit: null });
      expect(await linkInstallation(db, { ...args, installationId: `${base}2`, limit: null })).toBe(
        "linked"
      );
    } finally {
      await db.org.deleteMany({ where: { id: orgId } });
    }
  });
});
