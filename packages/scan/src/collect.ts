import path from "node:path";

import { WORKFLOW_PATH } from "./actions";

import {
  discoverRepos,
  lockfileKind,
  mergeDependencies,
  readLockfile,
  readRuntimeFile,
  type DiscoveredLockfile,
  type DiscoveredRuntimeFile,
  type ReadText,
} from "./discover";
import { isScannedPath } from "./files";
import { mergeRuntimes, runtimeFileKind } from "./runtimes";
import type { DetectedRuntime, LockedDependency } from "./types";

/** One repo of the POST /api/scan body. */
export interface ScanRepoPayload {
  name: string;
  path: string;
  ecosystem: "npm";
  dependencies: LockedDependency[];
  runtimes: DetectedRuntime[];
}

export type CollectMode =
  { kind: "single"; repoName: string } | { kind: "all"; includeWorktrees: boolean };

interface FileGroup {
  name: string;
  /** Runtime sources are relative to this directory. */
  absPath: string;
  lockfiles: DiscoveredLockfile[];
  runtimeFiles: DiscoveredRuntimeFile[];
}

async function readGroup(
  group: FileGroup,
  root: string,
  warn: (message: string) => void,
  read?: ReadText,
  manifestPaths: readonly string[] = [...group.runtimeFiles, ...group.lockfiles].map((f) => f.path)
): Promise<ScanRepoPayload | null> {
  const lists: LockedDependency[][] = [];
  const groupedRead = new Set<string>();
  for (const lockfile of group.lockfiles) {
    if (lockfile.kind === "maven" || lockfile.kind === "nuget") {
      if (groupedRead.has(lockfile.kind)) continue;
      groupedRead.add(lockfile.kind);
    }
    try {
      lists.push(
        await readLockfile(
          lockfile,
          read,
          lockfile.kind === "maven" || lockfile.kind === "nuget"
            ? [
                ...group.lockfiles.map((f) => f.path),
                ...manifestPaths.filter(
                  (f) =>
                    path.basename(f) ===
                      (lockfile.kind === "maven" ? "pom.xml" : "Directory.Packages.props") &&
                    !path.relative(path.dirname(f), group.absPath).split(path.sep).includes("..")
                ),
              ]
            : manifestPaths,
          group.absPath,
          warn
        )
      );
    } catch (err) {
      warn(`skip ${path.relative(root, lockfile.path)}: ${(err as Error).message}`);
    }
  }
  const runtimeLists: DetectedRuntime[][] = [];
  for (const file of group.runtimeFiles) {
    try {
      runtimeLists.push(await readRuntimeFile(file, group.absPath, read));
    } catch (err) {
      warn(`skip ${path.relative(root, file.path)}: ${(err as Error).message}`);
    }
  }
  const dependencies = mergeDependencies(lists);
  const runtimes = mergeRuntimes(runtimeLists);
  if (dependencies.length === 0 && runtimes.length === 0) return null;
  return { name: group.name, path: group.name, ecosystem: "npm", dependencies, runtimes };
}

/**
 * Builds the upload. Single mode treats `root` as one repo (a GitHub Actions checkout, or
 * one project folder): every lockfile and runtime file under it, nested git repos and a
 * root that is itself a linked worktree included. All mode keeps one repo per git repo.
 */
export async function collectRepos(
  root: string,
  mode: CollectMode,
  options: { maxDepth?: number; exclude?: readonly string[]; warn: (message: string) => void }
): Promise<ScanRepoPayload[]> {
  const exclude = new Set(options.exclude ?? []);
  const skip = (name: string) => options.warn(`skip ${name}: excluded with --exclude`);
  if (mode.kind === "single" && exclude.has(mode.repoName)) {
    skip(mode.repoName);
    return [];
  }
  const discovered = await discoverRepos(root, {
    includeWorktrees: mode.kind === "single" || mode.includeWorktrees,
    maxDepth: options.maxDepth,
  });
  const groups: FileGroup[] =
    mode.kind === "single"
      ? [
          {
            name: mode.repoName,
            absPath: root,
            lockfiles: discovered.flatMap((r) => r.lockfiles),
            runtimeFiles: discovered.flatMap((r) => r.runtimeFiles),
          },
        ]
      : discovered.filter((group) => {
          if (!exclude.has(group.name)) return true;
          skip(group.name);
          return false;
        });
  if (mode.kind === "all") {
    const found = new Set(discovered.map((group) => group.name));
    for (const name of exclude) {
      if (!found.has(name))
        options.warn(`--exclude ${name}: no repo with a lockfile or runtime file has that name`);
    }
  }
  const payloads: ScanRepoPayload[] = [];
  const manifestPaths = discovered.flatMap((r) =>
    [...r.runtimeFiles, ...r.lockfiles].map((f) => f.path)
  );
  for (const group of groups) {
    const payload = await readGroup(group, root, options.warn, undefined, manifestPaths);
    if (payload) payloads.push(payload);
  }
  return payloads;
}

// Virtual root for in-memory files: paths only have to be absolute and POSIX for the
// readers, nothing touches the disk.
const MEMORY_ROOT = "/briff-memory-repo";

/**
 * The same payload `collectRepos(root, { kind: "single", repoName })` builds for a checkout,
 * from in-memory files keyed by repo-relative POSIX path (the GitHub App's fetched blobs).
 * Paths the scanner would not read (`isScannedPath`) are ignored.
 */
export async function collectFromFiles(
  repoName: string,
  files: Readonly<Record<string, string>>,
  options: { warn: (message: string) => void }
): Promise<ScanRepoPayload | null> {
  const group: FileGroup = {
    name: repoName,
    absPath: MEMORY_ROOT,
    lockfiles: [],
    runtimeFiles: [],
  };
  for (const rel of Object.keys(files).sort()) {
    if (!isScannedPath(rel)) continue;
    const name = rel.split("/").pop() ?? rel;
    const abs = path.posix.join(MEMORY_ROOT, rel);
    const lockKind = WORKFLOW_PATH.test(rel) ? "actions" : lockfileKind(name);
    if (lockKind) group.lockfiles.push({ kind: lockKind, path: abs });
    const runtimeKind = runtimeFileKind(name);
    if (runtimeKind) group.runtimeFiles.push({ kind: runtimeKind, path: abs });
  }
  const read: ReadText = async (abs) => {
    const content = files[path.posix.relative(MEMORY_ROOT, abs)];
    if (content === undefined) throw new Error(`not fetched: ${abs}`);
    return content;
  };
  return readGroup(group, MEMORY_ROOT, options.warn, read);
}
