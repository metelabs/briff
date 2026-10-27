import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { run } from "./run";
import { SCANNER_VERSION } from "./version";

const LOCK = JSON.stringify({
  lockfileVersion: 3,
  packages: {
    "": { dependencies: { next: "^16.0.0" } },
    "node_modules/next": { version: "16.4.1" },
    "node_modules/semver": { version: "7.8.5" },
  },
});

interface Captured {
  code: number;
  out: string[];
  err: string[];
  requests: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[];
}

async function cli(
  argv: string[],
  env: Record<string, string | undefined>,
  cwd: string
): Promise<Captured> {
  const out: string[] = [];
  const err: string[] = [];
  const requests: Captured["requests"] = [];
  const code = await run(argv, env, {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    cwd,
    fetch: async (input, init) => {
      const body = JSON.parse(String(init.body)) as { repos: { name: string }[] };
      requests.push({
        url: input.toString(),
        headers: init.headers as Record<string, string>,
        body: body as unknown as Record<string, unknown>,
      });
      const repos = body.repos.map((r) => ({
        name: r.name,
        created: true,
        dependencies: 2,
        direct: 1,
        runtimes: 1,
      }));
      return new Response(JSON.stringify({ repos }), { status: 200 });
    },
  });
  return { code, out, err, requests };
}

describe("briff-scan run", () => {
  let root = "";
  let site = "";

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "briff-cli-"));
    site = path.join(root, "acme-site");
    const files: Record<string, string> = {
      "acme-site/.git/HEAD": "ref: refs/heads/main",
      "acme-site/package.json": JSON.stringify({ dependencies: { next: "^16.0.0" } }),
      "acme-site/package-lock.json": LOCK,
      "acme-site/.nvmrc": "22\n",
      "acme-site/src/index.ts": "export const secret = 'never uploaded';\n",
      // A nested repo (submodule) still belongs to the checkout in single-repo mode.
      "acme-site/vendor-tool/.git/HEAD": "ref: refs/heads/main",
      "acme-site/vendor-tool/Dockerfile": "FROM php:8.3-fpm\n",
      "other/.git/HEAD": "ref: refs/heads/main",
      "other/.node-version": "20.11.0\n",
    };
    for (const [rel, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
      await writeFile(path.join(root, rel), content);
    }
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("prints what it would send on a dry run and sends nothing", async () => {
    const res = await cli(["--dry-run"], {}, site);
    expect(res.code).toBe(0);
    expect(res.requests).toEqual([]);
    expect(res.out).toEqual([
      `root ${site}: 1 repos, 2 dependencies (1 direct), 3 runtimes`,
      `  ${"acme-site".padEnd(40)}      2 deps    1 direct`,
      "      debian 13 · vendor-tool/Dockerfile base image php:8.3-fpm",
      "      node 22 · .nvmrc",
      "      php 8.3 (8.3-fpm) · vendor-tool/Dockerfile",
      "dry run: nothing was sent",
    ]);
  });

  it("prints the exact payload with --dry-run --json", async () => {
    const res = await cli(["--dry-run", "--json"], {}, site);
    const parsed = JSON.parse(res.out.join("\n")) as {
      source: string;
      repos: { name: string; dependencies: unknown[]; runtimes: unknown[] }[];
    };
    expect(parsed.source).toBe("local");
    expect(parsed.repos).toHaveLength(1);
    expect(parsed.repos[0]).toMatchObject({
      name: "acme-site",
      path: "acme-site",
      ecosystem: "npm",
      dependencies: [
        { name: "next", version: "16.4.1", direct: true },
        { name: "semver", version: "7.8.5", direct: false },
      ],
    });
    expect(JSON.stringify(parsed)).not.toContain("never uploaded");
  });

  it("uploads the checked-out repo as owner/repo in GitHub Actions, in one final upload", async () => {
    const env = {
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "acme/site",
      BRIFF_API_URL: "https://briff.example",
      BRIFF_TOKEN: "brf_test",
    };
    const res = await cli([], env, site);
    expect(res.code).toBe(0);
    expect(res.requests).toHaveLength(1);
    const [req] = res.requests;
    expect(req.url).toBe("https://briff.example/api/scan");
    expect(req.headers.authorization).toBe("Bearer brf_test");
    expect(req.headers["user-agent"]).toBe(`briff-scan/${SCANNER_VERSION}`);
    expect(req.body).toMatchObject({ source: "github", final: true });
    expect(typeof req.body.scanId).toBe("string");
    expect((req.body.repos as { name: string }[]).map((r) => r.name)).toEqual(["acme/site"]);
    expect(res.out.at(-1)).toBe("uploaded 1 repos, 1 new");
  });

  it("splits --all-repos into chunks of one session; only the last is final", async () => {
    const res = await cli(["--all-repos", "--chunk", "1", "--token", "brf_x"], {}, root);
    expect(res.code).toBe(0);
    const names = res.requests.map((r) => (r.body.repos as { name: string }[])[0].name);
    expect(names).toEqual(["acme-site", "acme-site/vendor-tool", "other"]);
    expect(res.requests.map((r) => r.body.final)).toEqual([false, false, true]);
    expect(new Set(res.requests.map((r) => r.body.scanId)).size).toBe(1);
  });

  it("skips --exclude repos by their Briff name before reading them", async () => {
    const all = await cli(
      ["--all-repos", "--token", "brf_x", "--exclude", "acme-site/vendor-tool,missing"],
      {},
      root
    );
    expect(all.code).toBe(0);
    expect(all.err).toEqual([
      "skip acme-site/vendor-tool: excluded with --exclude",
      "--exclude missing: no repo with a lockfile or runtime file has that name",
    ]);
    expect(
      all.requests.flatMap((r) => (r.body.repos as { name: string }[]).map((x) => x.name))
    ).toEqual(["acme-site", "other"]);

    // Single-repo mode matches the name the repo would get: --repo-name, owner/repo, the folder.
    const actions = {
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "acme/site",
      BRIFF_TOKEN: "brf_x",
    };
    const single = await cli(["--exclude", "acme/site"], actions, site);
    expect(single.code).toBe(0);
    expect(single.requests).toEqual([]);
    expect(single.err).toEqual(["skip acme/site: excluded with --exclude"]);
    expect(single.out.at(-1)).toBe("nothing to upload");
    expect((await cli(["--dry-run", "--exclude", "acme-site"], {}, site)).out).toContain(
      "dry run: nothing was sent"
    );
    const named = await cli(["--dry-run", "--repo-name", "x", "--exclude", "acme-site"], {}, site);
    expect(named.err).toEqual([]);
    expect(named.out[0]).toMatch(/1 repos/);
  });

  it("exits 2 with a hint on a usage error and 1 when the upload fails", async () => {
    const usage = await cli([], {}, site);
    expect(usage.code).toBe(2);
    expect(usage.err[0]).toMatch(/BRIFF_TOKEN/);

    const failed = await run(
      [],
      { BRIFF_TOKEN: "brf_revoked" },
      {
        out: () => {},
        err: (l) => usage.err.push(l),
        cwd: site,
        fetch: async () =>
          new Response(JSON.stringify({ error: "This scan token was revoked." }), { status: 401 }),
      }
    );
    expect(failed).toBe(1);
    expect(usage.err.at(-1)).toMatch(/HTTP 401.*revoked/);
  });
});
