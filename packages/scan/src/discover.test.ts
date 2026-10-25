import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { discoverRepos, mergeDependencies, readLockfile, readRuntimeFile } from "./discover";
import { mergeRuntimes } from "./runtimes";

describe("discoverRepos", () => {
  let root = "";

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "briff-scan-"));
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: { "": { dependencies: { a: "^1.0.0" } }, "node_modules/a": { version: "1.2.3" } },
    });
    const files: Record<string, string> = {
      "site/.git/HEAD": "ref: refs/heads/main",
      "site/package.json": JSON.stringify({ dependencies: { a: "^1.0.0" } }),
      "site/package-lock.json": lock,
      "site/cms/package.json": "{}",
      "site/cms/package-lock.json": lock,
      "site/node_modules/x/package-lock.json": lock,
      "site-wt/.git": "gitdir: /somewhere/site/.git/worktrees/site-wt",
      "site-wt/package-lock.json": lock,
      "org/tool/.git/HEAD": "ref: refs/heads/main",
      "org/tool/pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "loose/package-lock.json": lock,
      "site/.nvmrc": "22\n",
      "site/docker/php/Dockerfile": "FROM php:8.3-fpm\n",
      "site/node_modules/x/Dockerfile": "FROM node:18\n",
      "site/test/__fixtures__/Dockerfile": "FROM node:16\n",
      "phpsite/.git/HEAD": "ref: refs/heads/main",
      "phpsite/composer.json": JSON.stringify({ require: { php: "^8.2" } }),
    };
    for (const [rel, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
      await writeFile(path.join(root, rel), content);
    }
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("groups lockfiles by git repo, skipping node_modules and worktrees", async () => {
    const repos = await discoverRepos(root);
    expect(repos.map((r) => r.name)).toEqual(["loose", "org/tool", "phpsite", "site"]);
    expect(repos.find((r) => r.name === "site")?.lockfiles).toHaveLength(2);
  });

  it("can include worktrees on request", async () => {
    const repos = await discoverRepos(root, { includeWorktrees: true });
    expect(repos.map((r) => r.name)).toContain("site-wt");
  });

  it("reads and merges lockfiles with direct flags from the sibling package.json", async () => {
    const [site] = (await discoverRepos(root)).filter((r) => r.name === "site");
    const lists = await Promise.all(site.lockfiles.map((l) => readLockfile(l)));
    expect(mergeDependencies(lists)).toEqual([{ name: "a", version: "1.2.3", direct: true }]);
  });

  it("finds runtime files beside lockfiles and repos that only have runtime files", async () => {
    const repos = await discoverRepos(root);
    const site = repos.find((r) => r.name === "site")!;
    const lists = await Promise.all(site.runtimeFiles.map((f) => readRuntimeFile(f, site.absPath)));
    expect(mergeRuntimes(lists).map((r) => `${r.name} ${r.normalized} · ${r.source}`)).toEqual([
      "node 22 · .nvmrc",
      "php 8.3 · docker/php/Dockerfile",
    ]);
    const php = repos.find((r) => r.name === "phpsite")!;
    expect(php.lockfiles).toEqual([]);
    expect(php.runtimeFiles.map((f) => f.kind)).toEqual(["composer-json"]);
  });
});

describe("mergeDependencies dev flag", () => {
  it("keeps require-dev only while no lockfile declares the package for production", () => {
    const dep = (direct: boolean, dev?: true) => ({
      name: "acme/test-runner",
      version: "10.5.9",
      direct,
      ecosystem: "Packagist" as const,
      ...(dev ? { dev } : {}),
    });
    expect(mergeDependencies([[dep(true, true)], [dep(false)]])[0].dev).toBe(true);
    expect(mergeDependencies([[dep(true, true)], [dep(true)]])[0].dev).toBeUndefined();
  });
});

describe("mergeDependencies with unresolved requirements", () => {
  it("drops a requirement once another file pins the package, keeping its direct flag", () => {
    const py = { ecosystem: "PyPI" as const };
    expect(
      mergeDependencies([
        [
          {
            name: "acme-web",
            version: ">=5.0,<6",
            direct: true,
            unresolved: true,
            manager: "pip",
            ...py,
          },
        ],
        [{ name: "acme-web", version: "5.0.6", direct: false, manager: "pipenv", ...py }],
        [{ name: "acme-cli", version: "*", direct: true, unresolved: true, manager: "pip", ...py }],
      ])
    ).toEqual([
      { name: "acme-cli", version: "*", direct: true, unresolved: true, manager: "pip", ...py },
      { name: "acme-web", version: "5.0.6", direct: true, manager: "pipenv", ...py },
    ]);
  });
  it("marks only the pinned copies the requirement admits as direct", () => {
    const py = { name: "acme-probe", ecosystem: "PyPI" as const, manager: "uv" as const };
    const merged = mergeDependencies([
      [{ ...py, version: ">=1,<2", direct: true, unresolved: true, manager: "pip" }],
      [
        { ...py, version: "1.4.0", direct: false },
        { ...py, version: "2.0.0", direct: false },
      ],
    ]);
    expect(merged.map((d) => [d.version, d.direct])).toEqual([
      ["1.4.0", true],
      ["2.0.0", false],
    ]);
  });
});

describe("mergeDependencies with a requirements export", () => {
  it("keeps a transitive lockfile row transitive although the export lists it", () => {
    const py = { name: "acme-child", version: "2.1.0", ecosystem: "PyPI" as const };
    for (const lists of [
      [
        [{ ...py, direct: false, manager: "uv" as const }],
        [{ ...py, direct: true, manager: "pip" as const }],
      ],
      [
        [{ ...py, direct: true, manager: "pip" as const }],
        [{ ...py, direct: false, manager: "poetry" as const }],
      ],
    ]) {
      expect(mergeDependencies(lists).map((d) => d.direct)).toEqual([false]);
    }
  });

  it("keeps the lockfile's group and dev flag over the export's guess", () => {
    const py = { name: "acme-mock", version: "1.2.0", ecosystem: "PyPI" as const };
    const fromLock = {
      ...py,
      direct: true,
      dev: true as const,
      group: "test",
      manager: "uv" as const,
    };
    const fromExport = { ...py, direct: true, manager: "pip" as const };
    for (const lists of [
      [[fromLock], [fromExport]],
      [[fromExport], [fromLock]],
    ]) {
      expect(mergeDependencies(lists)).toEqual([fromLock]);
    }
  });
});
