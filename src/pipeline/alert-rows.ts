import semver from "semver";

import type { PackageManager } from "@scan/ecosystems";

import { releaseLine } from "./fixes";

// Alert rows as the bulletin page and the Alerts page read them, and the pure helpers both
// share. Kept apart from bulletin-view.ts (which loads rows through withOrg), so pure callers
// such as the landing page's sample can use them without reaching the database layer.

/** How a repo declares one installed version (section, shape, workspace member, tool). */
export interface VersionDeclaration {
  dev?: boolean;
  group?: string;
  requirement?: string;
  project?: string;
  actionTags?: Record<string, string>;
  manager?: PackageManager;
}

/**
 * How a repo declares one installed version: its own declaration when attachInstalls recorded
 * one, else the row's (rows built without per-version declarations).
 */
export function declarationOf(
  r: Pick<
    AlertRow,
    "dev" | "group" | "requirement" | "project" | "manager" | "actionTags" | "declarations"
  >,
  installed: string
): VersionDeclaration {
  const own = r.declarations?.[installed];
  if (own) return own;
  return {
    ...(r.dev ? { dev: true } : {}),
    ...(r.group ? { group: r.group } : {}),
    ...(r.requirement ? { requirement: r.requirement } : {}),
    ...(r.project ? { project: r.project } : {}),
    ...(r.actionTags ? { actionTags: r.actionTags } : {}),
    ...(r.manager ? { manager: r.manager } : {}),
  };
}

export interface AlertRow {
  repo: { name: string };
  /** The repo's installed versions of the package; empty when none is on record. */
  installedVersions: readonly string[];
  /** The repo has the package as a direct dependency (in any of those versions). */
  direct: boolean;
  /** It declares it only for development (`require-dev`, attachInstalls). */
  dev?: boolean;
  /** The dependency group of a development-only Python package. */
  group?: string;
  /** The requirement as the manifest declares it (`acme-http[socks]==2.31.0; python_version>"3.8"`). */
  requirement?: string;
  /** The uv workspace member that declares it. */
  project?: string;
  /** Per installed version, its own declaration (attachInstalls); wins over the fields above. */
  declarations?: Record<string, VersionDeclaration>;
  /** The Python tool the repo installs the package with (attachInstalls). */
  actionTags?: Record<string, string>;
  manager?: PackageManager;
  advisory: {
    osvId: string;
    severity: string | null;
    affected: unknown;
    fixedVersion: string | null;
    /** `ecosystem` picks the commands (Alerts page); npm when absent. */
    package: { name: string; ecosystem?: string };
  };
}

/** Highest stable version per release line from `Advisory.fixedVersion` lists, newest line first. */
export function mergeFixedLists(lists: readonly (string | null)[]): string | null {
  const best = new Map<string, string>();
  for (const list of lists) {
    for (const part of (list ?? "").split(",")) {
      const v = semver.valid(part.trim().replace(/^v/, ""));
      if (!v || semver.prerelease(v) !== null) continue;
      const line = releaseLine(v);
      const current = best.get(line);
      if (!current || semver.gt(v, current)) best.set(line, v);
    }
  }
  if (best.size === 0) return null;
  return [...best.values()].sort(semver.rcompare).join(", ");
}
