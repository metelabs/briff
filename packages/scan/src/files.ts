import { WORKFLOW_PATH } from "./actions";

import { LOCKFILES, lockfileKind, SKIP_DIRS } from "./discover";
import { RUNTIME_FILE_NAMES, runtimeFileKind } from "./runtimes";

// The exact set of files the scanner reads, as a pure test on a repo-relative path. The
// CLI's directory walk and the GitHub App's tree filter both follow it, so the App fetches
// only these blobs and nothing else (docs/GITHUB-APP.md, "What Briff reads").

/** Directory levels the walk descends below the root (`discoverRepos` default). */
export const MAX_DEPTH = 6;

/** A lockfile, a manifest or a runtime file (version files, Dockerfiles, compose files). */
export function isScannedFileName(name: string): boolean {
  return name === "Gemfile" || lockfileKind(name) !== null || runtimeFileKind(name) !== null;
}

/**
 * Whether the scanner reads this repo-relative path (`apps/web/package-lock.json`): its
 * file name is scanned, no directory on the way is a dot-directory or a skipped one
 * (`node_modules`, `vendor`, `__fixtures__`, ...), and it is at most MAX_DEPTH levels down.
 */
export function isScannedPath(relPath: string, maxDepth = MAX_DEPTH): boolean {
  if (WORKFLOW_PATH.test(relPath)) return true;
  const parts = relPath.split("/");
  const name = parts.pop() ?? "";
  if (parts.length > maxDepth || !isScannedFileName(name)) return false;
  return parts.every((dir) => dir.length > 0 && !dir.startsWith(".") && !SKIP_DIRS.has(dir));
}

/**
 * File names read as they are: the lockfiles, then the runtime files, each once
 * (`composer.lock` is both: packages and the platform PHP version).
 */
export const SCANNED_FILE_NAMES: readonly string[] = [
  ...new Set([...Object.keys(LOCKFILES), "Gemfile", ...RUNTIME_FILE_NAMES]),
];

/**
 * The names `lockfileKind` and `runtimeFileKind` match by pattern, written for people (docs/GITHUB-APP.md, the
 * landing page). Each carries an example that files.test.ts runs through `isScannedFileName`,
 * so a pattern listed here is one the scanner really reads.
 */
export const SCANNED_NAME_PATTERNS: readonly { pattern: string; example: string }[] = [
  { pattern: "requirements-<x>.txt", example: "requirements-dev.txt" },
  { pattern: "requirements_<x>.txt", example: "requirements_prod.txt" },
  { pattern: "*.csproj", example: "Api.csproj" },
  { pattern: "Dockerfile.<x>", example: "Dockerfile.prod" },
  { pattern: "Containerfile.<x>", example: "Containerfile.dev" },
  { pattern: "*.Dockerfile", example: "web.Dockerfile" },
  { pattern: "*.dockerfile", example: "worker.dockerfile" },
  { pattern: "compose.yml", example: "compose.yml" },
  { pattern: "compose.yaml", example: "compose.yaml" },
  { pattern: "docker-compose.yml", example: "docker-compose.yml" },
  { pattern: "docker-compose.yaml", example: "docker-compose.yaml" },
  { pattern: "compose.<x>.yml", example: "compose.prod.yml" },
  { pattern: "docker-compose.<x>.yml", example: "docker-compose.override.yml" },
];
