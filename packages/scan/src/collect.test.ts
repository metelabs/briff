import { readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { collectFromFiles, collectRepos } from "./collect";
import { isScannedPath } from "./files";

const FIXTURES = path.join(__dirname, "__fixtures__");
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");

describe("isScannedPath", () => {
  it("selects lockfiles, manifests and runtime files outside skipped directories", () => {
    for (const p of [
      "package-lock.json",
      "apps/web/pnpm-lock.yaml",
      "yarn.lock",
      ".nvmrc",
      "docker/php/Dockerfile",
      "Dockerfile.prod",
      "compose.yaml",
      "go.mod",
      "composer.lock",
      "a/b/c/d/e/f/package.json",
    ]) {
      expect(isScannedPath(p), p).toBe(true);
    }
    for (const p of [
      "src/index.ts",
      "README.md",
      "Dockerfile.md",
      "node_modules/x/package.json",
      ".github/workflows/Dockerfile",
      "test/__fixtures__/package-lock.json",
      "vendor/x/composer.json",
      "a/b/c/d/e/f/g/package.json",
      ".env",
    ]) {
      expect(isScannedPath(p), p).toBe(false);
    }
  });
});

describe("collectFromFiles", () => {
  let root = "";
  const files: Record<string, string> = {};

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "briff-collect-"));
    const runtimes = path.join(FIXTURES, "runtimes");
    const tree: Record<string, string> = {
      "package.json": JSON.stringify({ dependencies: { a: "^1.0.0" }, engines: { node: ">=20" } }),
      "package-lock.json": JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": { dependencies: { a: "^1.0.0" } },
          "node_modules/a": { version: "1.2.3" },
          "node_modules/b": { version: "2.0.0" },
        },
      }),
      "apps/admin/pnpm-lock.yaml": fixture("pnpm-v9-workspace.yaml"),
      "apps/legacy/yarn.lock": fixture("yarn-v1.lock"),
      "apps/legacy/package.json": JSON.stringify({ dependencies: { lodash: "^4.17.0" } }),
      ".nvmrc": "22\n",
      "docker/php/Dockerfile": readFileSync(path.join(runtimes, "Dockerfile"), "utf8"),
      "docker-compose.yml": readFileSync(path.join(runtimes, "docker-compose.yml"), "utf8"),
      "api/go.mod": readFileSync(path.join(runtimes, "go.mod"), "utf8"),
      "cms/composer.json": readFileSync(path.join(runtimes, "composer.json"), "utf8"),
      "cms/composer.lock": readFileSync(path.join(runtimes, "composer.lock"), "utf8"),
      // Never read: skipped directories, dot-directories, too deep, not a scanned name.
      "node_modules/x/package-lock.json": "{",
      ".github/Dockerfile": "FROM node:12\n",
      "test/__fixtures__/Dockerfile": "FROM node:14\n",
      "a/b/c/d/e/f/g/.nvmrc": "16\n",
      "src/index.ts": "export {};\n",
    };
    for (const [rel, content] of Object.entries(tree)) {
      await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
      await writeFile(path.join(root, rel), content);
    }
    // What the App would have: every file of the tree (it filters by isScannedPath itself).
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]
      );
    for (const abs of walk(root)) {
      files[path.relative(root, abs).split(path.sep).join("/")] = await readFile(abs, "utf8");
    }
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("builds the same repo payload as the CLI on a checkout of the same files", async () => {
    const warnings: string[] = [];
    const [cli] = await collectRepos(
      root,
      { kind: "single", repoName: "acme/site" },
      { warn: (m) => warnings.push(`cli ${m}`) }
    );
    const app = await collectFromFiles("acme/site", files, {
      warn: (m) => warnings.push(`app ${m}`),
    });
    expect(app).toEqual(cli);
    expect(cli.dependencies.length).toBeGreaterThan(3);
    expect(cli.runtimes.map((r) => r.source)).toContain("docker/php/Dockerfile");
    expect(JSON.stringify(cli)).not.toMatch(/node 12|node 14|node 16|"16"/);
    expect(warnings).toEqual([]);
  });

  it("returns null without any scanned file", async () => {
    expect(await collectFromFiles("acme/empty", { "README.md": "# x" }, { warn: () => {} })).toBe(
      null
    );
  });
});

describe("collectFromFiles with several ecosystems", () => {
  it("tags non-npm rows with their ecosystem and leaves npm rows as before", async () => {
    const payload = await collectFromFiles(
      "acme/shop",
      {
        "package.json": JSON.stringify({ dependencies: { a: "^1.0.0" } }),
        "package-lock.json": JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "": { dependencies: { a: "^1.0.0" } },
            "node_modules/a": { version: "1.2.3" },
          },
        }),
        "composer.json": fixture("composer-app.json"),
        "composer.lock": fixture("composer-app.lock"),
        "vendor/acme/log/composer.lock": "{",
      },
      { warn: (m) => expect.fail(m) }
    );
    expect(payload?.ecosystem).toBe("npm");
    expect(payload?.dependencies.find((d) => d.name === "a")).toEqual({
      name: "a",
      version: "1.2.3",
      direct: true,
    });
    expect(payload?.dependencies.filter((d) => d.ecosystem === "Packagist")).toHaveLength(4);
    // composer.lock is also a runtime file: its platform php still reaches the runtimes.
    expect(payload?.runtimes.map((r) => `${r.name} ${r.version} · ${r.source}`)).toEqual([
      "php ^8.2 · composer.json require.php",
      "php ^8.2 · composer.lock platform.php",
    ]);
  });
});

describe("collectFromFiles with Python projects", () => {
  it("reads every Python lockfile kind beside its manifest and skips virtualenvs", async () => {
    const payload = await collectFromFiles(
      "acme/data",
      {
        "api/pyproject.toml": fixture("poetry-app.toml"),
        "api/poetry.lock": fixture("poetry-app.lock"),
        "service/pyproject.toml": fixture("uv-app.toml"),
        "service/uv.lock": fixture("uv-app.lock"),
        "web/Pipfile": fixture("pipenv-app.Pipfile"),
        "web/Pipfile.lock": fixture("pipenv-app.lock"),
        "jobs/requirements.txt": `${fixture("requirements-compiled.txt")}acme-cron==1.2.0\n`,
        "jobs/requirements-dev.txt": "acme-lint==0.6.9\n",
        "venv/lib/python3.12/site-packages/acme/requirements.txt": "acme-never==1.0.0\n",
        "tools/site-packages/requirements.txt": "acme-never==1.0.0\n",
      },
      { warn: (m) => expect.fail(m) }
    );
    const deps = payload?.dependencies ?? [];
    expect(deps.every((d) => d.ecosystem === "PyPI")).toBe(true);
    expect(deps.find((d) => d.name === "acme-never")).toBeUndefined();
    // Pinned by uv.lock and by requirements-dev.txt: one row, the lockfile's tool and
    // declaration (the dev group) win.
    expect(deps.filter((d) => d.name === "acme-lint")).toEqual([
      {
        name: "acme-lint",
        version: "0.6.9",
        direct: true,
        ecosystem: "PyPI",
        dev: true,
        group: "dev",
        manager: "uv",
      },
    ]);
    expect(new Set(deps.map((d) => d.manager))).toEqual(new Set(["poetry", "uv", "pipenv", "pip"]));
  });
});

describe("collectFromFiles with a Go module", () => {
  it("reads go.mod for modules and the go runtime, never go.sum or vendored modules", async () => {
    const payload = await collectFromFiles(
      "acme/jobs",
      {
        "go.mod": fixture("go-app.mod"),
        "go.sum": "github.com/acme/never v1.0.0 h1:x=\n",
        "vendor/github.com/acme/kit/go.mod":
          "module github.com/acme/kit\n\nrequire github.com/acme/never v1.0.0\n",
      },
      { warn: (m) => expect.fail(m) }
    );
    expect(payload?.dependencies.find((d) => d.name === "github.com/acme/never")).toBeUndefined();
    expect(payload?.dependencies.find((d) => d.name === "golang.org/x/net")).toEqual({
      name: "golang.org/x/net",
      version: "0.30.0",
      direct: true,
      ecosystem: "Go",
    });
    expect(payload?.runtimes.map((r) => `${r.name} ${r.version}`)).toEqual([
      "go 1.23.0",
      "go 1.23.4",
    ]);
  });
});
