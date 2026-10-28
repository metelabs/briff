import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  githubScanKey,
  MAX_BLOB_BYTES,
  MAX_FILES_PER_REPO,
  scannedTreeEntries,
  selectBlobs,
} from "./scan";

const tree = JSON.parse(
  readFileSync(path.join(__dirname, "__fixtures__", "vercel-ms", "tree.json"), "utf8")
);

describe("scannedTreeEntries", () => {
  it("keeps only the files the scanner reads from a recorded tree", () => {
    expect(scannedTreeEntries(tree).map((e) => e.path)).toEqual([
      ".github/workflows/quality.yml",
      ".github/workflows/release.yml",
      ".github/workflows/test.yml",
      "package.json",
      "pnpm-lock.yaml",
    ]);
  });

  it("drops symlinks, submodules, skipped directories and oversized blobs", () => {
    const entry = (p: string, over: Record<string, unknown> = {}) => ({
      path: p,
      mode: "100644",
      type: "blob",
      sha: "0".repeat(40),
      size: 10,
      ...over,
    });
    const entries = scannedTreeEntries({
      truncated: false,
      tree: [
        entry("package-lock.json"),
        entry("bin/Dockerfile", { mode: "100755" }),
        entry("link/package.json", { mode: "120000" }),
        entry("vendored", { mode: "160000", type: "commit" }),
        entry("node_modules/a/package.json"),
        entry(".devcontainer/Dockerfile"),
        entry("huge/yarn.lock", { size: MAX_BLOB_BYTES + 1 }),
        entry("src/index.ts"),
      ],
    });
    expect(entries.map((e) => e.path)).toEqual(["package-lock.json", "bin/Dockerfile"]);
  });
});

describe("scannedTreeEntries per ecosystem", () => {
  it("fetches the lockfiles and manifests of every supported ecosystem, never vendored copies", () => {
    const entry = (p: string) => ({
      path: p,
      mode: "100644",
      type: "blob",
      sha: "0".repeat(40),
      size: 10,
    });
    const entries = scannedTreeEntries({
      truncated: false,
      tree: [
        entry("composer.json"),
        entry("composer.lock"),
        entry("apps/api/composer.lock"),
        entry("vendor/acme/log/composer.lock"),
        entry("vendor/acme/log/composer.json"),
        entry("src/Kernel.php"),
        entry("pyproject.toml"),
        entry("poetry.lock"),
        entry("services/jobs/uv.lock"),
        entry("web/Pipfile"),
        entry("web/Pipfile.lock"),
        entry("requirements.txt"),
        entry("requirements-dev.txt"),
        entry("docs/requirements_docs.txt"),
        entry("venv/lib/python3.12/site-packages/acme/requirements.txt"),
        entry("notes.txt"),
        entry("cmd/worker/go.mod"),
        entry("cmd/worker/go.sum"),
        entry("vendor/github.com/acme/kit/go.mod"),
      ],
    });
    expect(entries.map((e) => e.path)).toEqual([
      "composer.json",
      "composer.lock",
      "apps/api/composer.lock",
      "pyproject.toml",
      "poetry.lock",
      "services/jobs/uv.lock",
      "web/Pipfile",
      "web/Pipfile.lock",
      "requirements.txt",
      "requirements-dev.txt",
      "docs/requirements_docs.txt",
      "cmd/worker/go.mod",
    ]);
  });
});

describe("selectBlobs", () => {
  const blob = (p: string, size = 10) => ({
    path: p,
    mode: "100644",
    type: "blob",
    sha: "0".repeat(40),
    size,
  });

  it("marks a read cut by the size or file budget as incomplete", () => {
    expect(selectBlobs({ truncated: false, tree: [blob("package-lock.json")] }).cut).toBe(false);
    expect(
      selectBlobs({ truncated: false, tree: [blob("package-lock.json", MAX_BLOB_BYTES + 1)] })
    ).toEqual({ entries: [], cut: true });
    const many = Array.from({ length: MAX_FILES_PER_REPO + 1 }, (_, i) =>
      blob(`p${i}/package.json`)
    );
    const res = selectBlobs({ truncated: false, tree: many });
    expect(res.entries).toHaveLength(MAX_FILES_PER_REPO);
    expect(res.cut).toBe(true);
  });
});

describe("githubScanKey", () => {
  it("tells long repo sets apart that share a prefix", () => {
    const base = Array.from({ length: 40 }, (_, i) => `acme/a-fairly-long-repository-name-${i}`);
    expect(githubScanKey({ installationId: "1", repos: [...base, "acme/x"] })).not.toBe(
      githubScanKey({ installationId: "1", repos: [...base, "acme/y"] })
    );
  });

  it("is one key per installation and repo set", () => {
    expect(githubScanKey({ installationId: "1" })).toBe("github-scan:1:*");
    expect(githubScanKey({ installationId: "1", repos: ["b/x", "a/y"] })).toBe(
      githubScanKey({ installationId: "1", repos: ["a/y", "b/x"] })
    );
  });
});

it("fetches Bundler lockfiles and Gemfiles, excluding vendored copies", () => {
  const paths = ["Gemfile", "Gemfile.lock", "apps/api/Gemfile", "vendor/Gemfile.lock", "app.rb"];
  expect(
    scannedTreeEntries({
      truncated: false,
      tree: paths.map((path) => ({
        path,
        mode: "100644",
        type: "blob",
        sha: "0".repeat(40),
        size: 30,
      })),
    }).map((e) => e.path)
  ).toEqual(paths.slice(0, 3));
});

it("fetches Cargo lockfiles and workspace manifests, excluding vendored copies", () => {
  const paths = ["Cargo.toml", "Cargo.lock", "apps/api/Cargo.toml", "vendor/Cargo.lock", "app.rs"];
  expect(
    scannedTreeEntries({
      truncated: false,
      tree: paths.map((path) => ({
        path,
        mode: "100644",
        type: "blob",
        sha: "0".repeat(40),
        size: 30,
      })),
    }).map((e) => e.path)
  ).toEqual(paths.slice(0, 3));
});

it("fetches Maven and Gradle dependency files, excluding vendored copies", () => {
  const paths = [
    "pom.xml",
    "gradle.lockfile",
    "apps/api/build.gradle.kts",
    "vendor/pom.xml",
    "App.java",
  ];
  expect(
    scannedTreeEntries({
      truncated: false,
      tree: paths.map((path) => ({
        path,
        mode: "100644",
        type: "blob",
        sha: "0".repeat(40),
        size: 30,
      })),
    }).map((e) => e.path)
  ).toEqual(paths.slice(0, 3));
});

it("fetches NuGet dependency files, excluding vendored copies", () => {
  const paths = [
    "packages.lock.json",
    "Directory.Packages.props",
    "apps/api/Acme.csproj",
    "vendor/Acme.csproj",
    "App.cs",
  ];
  expect(
    scannedTreeEntries({
      truncated: false,
      tree: paths.map((path) => ({
        path,
        mode: "100644",
        type: "blob",
        sha: "0".repeat(40),
        size: 30,
      })),
    }).map((e) => e.path)
  ).toEqual(paths.slice(0, 3));
});

it("fetches SwiftPM pins and their manifest while excluding ordinary Swift sources", () => {
  const paths = [
    "Package.resolved",
    "Package.swift",
    "Acme.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved",
    "Sources/main.swift",
    "vendor/Package.resolved",
  ];
  expect(
    scannedTreeEntries({
      truncated: false,
      tree: paths.map((path) => ({
        path,
        mode: "100644",
        type: "blob",
        sha: "0".repeat(40),
        size: 30,
      })),
    }).map((row) => row.path)
  ).toEqual(paths.slice(0, 3));
});
