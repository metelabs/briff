import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { composerDeclared, parseComposerLock } from "./composer-lock";
import { parseCargoLock } from "./cargo-lock";
import { parseRubyLock } from "./ruby-lock";
import { parseGoMod } from "./go-mod";
import { parseNpmLock } from "./npm-lock";
import { parsePnpmLock } from "./pnpm-lock";
import {
  admits,
  parsePipfileLock,
  parsePoetryLock,
  parseRequirements,
  parseUvLock,
  pipfileDeclared,
  pyprojectDeclared,
} from "./python-lock";
import { parseRuntimeFile, runtimeFileKind, type RuntimeFileKind } from "./runtimes";
import { mergeDeclarations } from "./ecosystems";
import type { DetectedRuntime, LockedDependency } from "./types";
import { parseYarnLock } from "./yarn-lock";

export type LockfileKind =
  | "npm"
  | "pnpm"
  | "yarn"
  | "composer"
  | "poetry"
  | "uv"
  | "pipenv"
  | "requirements"
  | "gomod"
  | "bundler"
  | "cargo";

/** Reads a file's text; the CLI reads the disk, the GitHub App reads fetched blobs. */
export type ReadText = (filePath: string) => Promise<string>;

const readDisk: ReadText = (filePath) => readFile(filePath, "utf8");

export const LOCKFILES: Readonly<Record<string, LockfileKind>> = {
  "package-lock.json": "npm",
  "npm-shrinkwrap.json": "npm",
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "composer.lock": "composer",
  "poetry.lock": "poetry",
  "uv.lock": "uv",
  "Pipfile.lock": "pipenv",
  "requirements.txt": "requirements",
  "go.mod": "gomod",
  "Gemfile.lock": "bundler",
  "Cargo.lock": "cargo",
};

// `requirements-dev.txt`, `requirements_prod.txt`: the common split of requirements.txt.
const REQUIREMENTS_VARIANT = /^requirements[-_][\w.-]+\.txt$/;

/** The lockfile kind of a file name (LOCKFILES, plus requirements-<x>.txt variants); null otherwise. */
export function lockfileKind(fileName: string): LockfileKind | null {
  return LOCKFILES[fileName] ?? (REQUIREMENTS_VARIANT.test(fileName) ? "requirements" : null);
}

/** Directories never entered (besides dot-directories). */
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "target",
  "Pods",
  "DerivedData",
  // Python virtualenvs and installed packages: their files describe what pip installed, not
  // what the project declares (`.venv` is already a dot-directory).
  "venv",
  "site-packages",
  "__pypackages__",
  // Test data: lockfiles, Dockerfiles and version files there describe nothing that runs.
  "__fixtures__",
  "fixtures",
  "testdata",
  "__mocks__",
]);

export interface DiscoverOptions {
  maxDepth?: number;
  includeWorktrees?: boolean;
}

export interface DiscoveredLockfile {
  kind: LockfileKind;
  path: string;
}

export interface DiscoveredRuntimeFile {
  kind: RuntimeFileKind;
  path: string;
}

export interface DiscoveredRepo {
  /** Path relative to the scan root; doubles as the repo name. */
  name: string;
  absPath: string;
  lockfiles: DiscoveredLockfile[];
  runtimeFiles: DiscoveredRuntimeFile[];
}

type GitMarker = "repo" | "worktree" | null;

async function gitMarker(dir: string): Promise<GitMarker> {
  const gitPath = path.join(dir, ".git");
  try {
    const info = await stat(gitPath);
    if (info.isDirectory()) return "repo";
    const content = await readFile(gitPath, "utf8");
    // Linked worktrees duplicate another checkout; submodules are real repos.
    return /gitdir:.*[/\\]worktrees[/\\]/.test(content) ? "worktree" : "repo";
  } catch {
    return null;
  }
}

/**
 * Walks `root` for lockfiles and runtime files (version files, manifests,
 * Dockerfiles, compose files) and groups them by the nearest enclosing git repo.
 */
export async function discoverRepos(
  root: string,
  options: DiscoverOptions = {}
): Promise<DiscoveredRepo[]> {
  const maxDepth = options.maxDepth ?? 6;
  const repos = new Map<string, DiscoveredRepo>();

  const visit = async (dir: string, depth: number, repoRoot: string | null): Promise<void> => {
    const marker = await gitMarker(dir);
    if (marker === "worktree" && !options.includeWorktrees) return;
    const currentRepo = marker ? dir : repoRoot;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const repoFor = (): DiscoveredRepo => {
      const owner = currentRepo ?? dir;
      const name = path.relative(root, owner) || path.basename(owner);
      const repo = repos.get(owner) ?? { name, absPath: owner, lockfiles: [], runtimeFiles: [] };
      repos.set(owner, repo);
      return repo;
    };

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const lockKind = lockfileKind(entry.name);
      if (lockKind) repoFor().lockfiles.push({ kind: lockKind, path: path.join(dir, entry.name) });
      const runtimeKind = runtimeFileKind(entry.name);
      if (runtimeKind) {
        repoFor().runtimeFiles.push({ kind: runtimeKind, path: path.join(dir, entry.name) });
      }
    }

    if (depth >= maxDepth) return;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      await visit(path.join(dir, entry.name), depth + 1, currentRepo);
    }
  };

  await visit(root, 0, null);
  return [...repos.values()].sort((a, b) => a.name.localeCompare(b.name));
}

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

async function readDeclaredRanges(dir: string, read: ReadText): Promise<Record<string, string>> {
  try {
    const manifest = JSON.parse(await read(path.join(dir, "package.json"))) as PackageManifest;
    return {
      ...manifest.optionalDependencies,
      ...manifest.devDependencies,
      ...manifest.dependencies,
    };
  } catch {
    return {};
  }
}

async function readOptional(filePath: string, read: ReadText): Promise<string | null> {
  try {
    return await read(filePath);
  } catch {
    return null;
  }
}

/**
 * Reads INSTALLED versions from a lockfile; direct deps come from the sibling manifest
 * (package.json, composer.json).
 */
export async function readLockfile(
  lockfile: DiscoveredLockfile,
  read: ReadText = readDisk,
  manifestPaths: readonly string[] = []
): Promise<LockedDependency[]> {
  const content = await read(lockfile.path);
  const dir = path.dirname(lockfile.path);
  switch (lockfile.kind) {
    case "composer":
      return parseComposerLock(
        content,
        composerDeclared(await readOptional(path.join(dir, "composer.json"), read))
      );
    case "poetry":
      return parsePoetryLock(
        content,
        pyprojectDeclared(await readOptional(path.join(dir, "pyproject.toml"), read))
      );
    case "uv":
      return parseUvLock(
        content,
        pyprojectDeclared(await readOptional(path.join(dir, "pyproject.toml"), read))
      );
    case "pipenv":
      return parsePipfileLock(
        content,
        pipfileDeclared(await readOptional(path.join(dir, "Pipfile"), read))
      );
    case "requirements":
      return parseRequirements(content);
    case "gomod":
      return parseGoMod(content);
    case "bundler":
      return parseRubyLock(content, await readOptional(path.join(dir, "Gemfile"), read));
    case "cargo": {
      const manifests: Record<string, string> = {};
      for (const file of new Set([path.join(dir, "Cargo.toml"), ...manifestPaths])) {
        const relative = path.relative(dir, file);
        if (relative.startsWith("..") || path.basename(file) !== "Cargo.toml") continue;
        const text = await readOptional(file, read);
        if (text !== null) manifests[relative.split(path.sep).join("/")] = text;
      }
      return parseCargoLock(content, manifests);
    }
  }
  const ranges = await readDeclaredRanges(dir, read);
  switch (lockfile.kind) {
    case "npm":
      return parseNpmLock(content, Object.keys(ranges));
    case "pnpm":
      return parsePnpmLock(content);
    case "yarn":
      return parseYarnLock(content, ranges);
  }
}

/**
 * Union of all lockfiles in a repo; a version that is direct anywhere stays direct. A
 * version a lockfile pins wins its manager over a requirements file listing the same one
 * (`poetry export` output next to poetry.lock is still a Poetry project), and an unresolved
 * requirement is dropped when another file pins the package.
 */
export function mergeDependencies(lists: LockedDependency[][]): LockedDependency[] {
  const merged = new Map<string, LockedDependency>();
  for (const list of lists) {
    for (const dep of list) {
      const id = `${dep.ecosystem ?? "npm"}\0${dep.name}@${dep.version}`;
      const prev = merged.get(id);
      if (!prev) {
        merged.set(id, { ...dep });
        continue;
      }
      // Development-only while no file declares it for production.
      // A Python lockfile's declaration (group, extra, dev) wins over a requirements export of
      // the same pin, which knows none of them.
      const lockfile = (d: LockedDependency) => d.manager !== undefined && d.manager !== "pip";
      const authority =
        lockfile(prev) && dep.manager === "pip"
          ? prev
          : lockfile(dep) && prev.manager === "pip"
            ? dep
            : null;
      // Otherwise every section either row declares is kept.
      const union = authority ? null : mergeDeclarations(prev, dep);
      const dev = authority ? authority.dev === true : union?.dev === true;
      const group = authority ? authority.group : union?.group;
      // An export lists every pin as direct; the lockfile knows which ones the project declares.
      prev.direct = authority ? authority.direct : prev.direct || dep.direct;
      if (dev) prev.dev = true;
      else delete prev.dev;
      if (group) prev.group = group;
      else delete prev.group;
      // The declaration's shape and owner follow the same authority.
      const requirement = authority ? authority.requirement : (prev.requirement ?? dep.requirement);
      const project = authority ? authority.project : (prev.project ?? dep.project);
      if (requirement) prev.requirement = requirement;
      else delete prev.requirement;
      if (project) prev.project = project;
      else delete prev.project;
      if (prev.manager === "pip" && dep.manager && dep.manager !== "pip")
        prev.manager = dep.manager;
    }
  }
  // A requirement says nothing more once another file of the repo pins the package; the
  // repo's direct flag still counts.
  const pinned = new Map<string, LockedDependency[]>();
  for (const dep of merged.values()) {
    if (dep.unresolved) continue;
    const key = `${dep.ecosystem ?? "npm"}\0${dep.name}`;
    pinned.set(key, [...(pinned.get(key) ?? []), dep]);
  }
  for (const [id, dep] of merged) {
    const installs = dep.unresolved ? pinned.get(`${dep.ecosystem ?? "npm"}\0${dep.name}`) : null;
    if (!installs) continue;
    if (dep.direct) for (const install of admittedBy(dep.version, installs)) install.direct = true;
    merged.delete(id);
  }
  return [...merged.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      a.version.localeCompare(b.version) ||
      (a.ecosystem ?? "npm").localeCompare(b.ecosystem ?? "npm")
  );
}

/**
 * The pinned installs a requirement as written (`>=1,<2`) covers; an unreadable one covers
 * a lone install only, since it cannot tell several copies apart.
 */
function admittedBy(requirement: string, installs: LockedDependency[]): LockedDependency[] {
  const verdicts = installs.map((install) => admits(requirement, install.version));
  return installs.filter(
    (_, i) => verdicts[i] === true || (verdicts[i] === null && installs.length === 1)
  );
}

/** Runtimes one file declares; sources are relative to the repo root (`docker/php/Dockerfile`). */
export async function readRuntimeFile(
  file: DiscoveredRuntimeFile,
  repoAbsPath: string,
  read: ReadText = readDisk
): Promise<DetectedRuntime[]> {
  const content = await read(file.path);
  const source = path.relative(repoAbsPath, file.path).split(path.sep).join("/");
  return parseRuntimeFile(file.kind, content, source);
}
