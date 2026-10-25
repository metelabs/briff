import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { composerDeclared, parseComposerLock } from "./composer-lock";
import { parseNpmLock } from "./npm-lock";
import { parsePnpmLock, parsePnpmPackageKey } from "./pnpm-lock";
import type { LockedDependency } from "./types";
import { parseYarnLock } from "./yarn-lock";

const fixture = (name: string) => readFileSync(path.join(__dirname, "__fixtures__", name), "utf8");
const find = (deps: LockedDependency[], name: string, version?: string) =>
  deps.find((d) => d.name === name && (version === undefined || d.version === version));

describe("parseNpmLock (v3 with workspaces)", () => {
  const deps = parseNpmLock(fixture("npm-v3-workspace.json"), ["react", "typescript"]);

  it("reads installed versions, not ranges", () => {
    expect(find(deps, "react", "19.0.0")).toBeDefined();
    expect(find(deps, "typescript")?.version).toBe("5.9.3");
  });

  it("marks top-level declared deps direct, including workspace manifests", () => {
    expect(find(deps, "react", "19.0.0")?.direct).toBe(true);
    expect(find(deps, "typescript")?.direct).toBe(true);
    expect(find(deps, "lodash", "4.17.21")?.direct).toBe(true);
    expect(find(deps, "lodash", "4.17.20")?.direct).toBe(true);
  });

  it("keeps nested copies as transitive and skips workspace links", () => {
    expect(find(deps, "react", "18.3.1")?.direct).toBe(false);
    expect(find(deps, "loose-envify")?.direct).toBe(false);
    expect(find(deps, "app")).toBeUndefined();
    expect(deps).toHaveLength(7);
  });

  it("supports lockfileVersion 1 trees", () => {
    const v1 = JSON.stringify({
      lockfileVersion: 1,
      dependencies: {
        a: { version: "1.0.0", dependencies: { b: { version: "2.0.0" } } },
        c: { version: "file:../c" },
      },
    });
    expect(parseNpmLock(v1, ["a"])).toEqual([
      { name: "a", version: "1.0.0", direct: true },
      { name: "b", version: "2.0.0", direct: false },
    ]);
  });
});

describe("parsePnpmLock", () => {
  it("collects direct deps from every workspace importer (v9)", () => {
    const deps = parsePnpmLock(fixture("pnpm-v9-workspace.yaml"));
    expect(deps).toHaveLength(6);
    expect(find(deps, "next")).toEqual({ name: "next", version: "16.4.1", direct: true });
    expect(find(deps, "@sentry/node")?.direct).toBe(true);
    expect(find(deps, "typescript")?.direct).toBe(true);
    expect(find(deps, "scheduler")?.direct).toBe(false);
    expect(find(deps, "react-dom")?.direct).toBe(false);
    expect(find(deps, "@scope/shared")).toBeUndefined();
  });

  it("handles v6 lockfiles without importers", () => {
    const deps = parsePnpmLock(fixture("pnpm-v6.yaml"));
    expect(find(deps, "react")).toEqual({ name: "react", version: "18.2.0", direct: true });
    expect(find(deps, "@types/react")?.direct).toBe(true);
    expect(find(deps, "loose-envify")?.direct).toBe(false);
  });

  it("parses every historical package key shape", () => {
    expect(parsePnpmPackageKey("@a/b@1.0.0", false)).toEqual({ name: "@a/b", version: "1.0.0" });
    expect(parsePnpmPackageKey("/@a/b@1.0.0", true)).toEqual({ name: "@a/b", version: "1.0.0" });
    expect(parsePnpmPackageKey("/@a/b/1.0.0_react@18.0.0", true)).toEqual({
      name: "@a/b",
      version: "1.0.0",
    });
    expect(parsePnpmPackageKey("x@1.0.0(react@18.0.0)", false)).toEqual({
      name: "x",
      version: "1.0.0",
    });
  });
});

describe("parseYarnLock", () => {
  it("parses v1 entries and picks the direct version by declared range", () => {
    const deps = parseYarnLock(fixture("yarn-v1.lock"), { lodash: "^4.17.21" });
    expect(find(deps, "@babel/core")).toEqual({
      name: "@babel/core",
      version: "7.24.0",
      direct: false,
    });
    expect(find(deps, "lodash", "4.17.21")?.direct).toBe(true);
    expect(find(deps, "lodash", "3.10.1")?.direct).toBe(false);
  });

  it("parses berry entries and skips workspaces", () => {
    const deps = parseYarnLock(fixture("yarn-berry.lock"), { lodash: "^4.17.21" });
    expect(deps).toEqual([{ name: "lodash", version: "4.17.21", direct: true }]);
  });
});

describe("parseComposerLock", () => {
  const deps = parseComposerLock(
    fixture("composer-app.lock"),
    composerDeclared(fixture("composer-app.json"))
  );

  it("reads packages and packages-dev with installed versions, tagged Packagist", () => {
    expect(deps).toEqual([
      { name: "acme/http-kernel", version: "6.4.3", direct: true, ecosystem: "Packagist" },
      { name: "acme/log", version: "3.0.2", direct: false, ecosystem: "Packagist" },
      { name: "acme/mixed-case", version: "2.1.0", direct: true, ecosystem: "Packagist" },
      {
        name: "acme/test-runner",
        version: "10.5.9",
        direct: true,
        ecosystem: "Packagist",
        dev: true,
      },
    ]);
  });

  it("skips branch installs and platform requirements", () => {
    expect(find(deps, "acme/forked-widget")).toBeUndefined();
    expect(find(deps, "acme/next-tool")).toBeUndefined();
    expect(find(deps, "php")).toBeUndefined();
    const declared = composerDeclared(fixture("composer-app.json"));
    expect([...declared.require, ...declared.requireDev]).not.toContain("ext-json");
  });

  it("marks nothing direct without a readable composer.json", () => {
    const loose = parseComposerLock(fixture("composer-app.lock"), composerDeclared(null));
    expect(loose.every((d) => !d.direct && !d.dev)).toBe(true);
    expect(composerDeclared("{")).toEqual({ require: [], requireDev: [] });
  });
});
