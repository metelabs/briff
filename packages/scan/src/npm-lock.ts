import { isNonRegistryVersion } from "./package-name";
import type { LockedDependency } from "./types";

interface NpmLockPackage {
  name?: string;
  version?: string;
  link?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface NpmLockV1Dependency {
  version?: string;
  dependencies?: Record<string, NpmLockV1Dependency>;
}

interface NpmLockfile {
  lockfileVersion?: number;
  packages?: Record<string, NpmLockPackage>;
  dependencies?: Record<string, NpmLockV1Dependency>;
}

const NODE_MODULES = "node_modules/";

function declaredNames(pkg: NpmLockPackage | undefined): string[] {
  if (!pkg) return [];
  return [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ];
}

/**
 * Parses package-lock.json (v1, v2, v3) into installed versions.
 * `directNames` comes from the nearest package.json; workspace manifests
 * recorded in the lockfile also count as direct.
 */
export function parseNpmLock(content: string, directNames: Iterable<string>): LockedDependency[] {
  const lock = JSON.parse(content) as NpmLockfile;
  const direct = new Set(directNames);
  const out: LockedDependency[] = [];

  if (lock.packages) {
    // Workspace package entries live at non-node_modules keys ("packages/app").
    const workspaceDirs: string[] = [];
    for (const [key, pkg] of Object.entries(lock.packages)) {
      if (key.includes(NODE_MODULES) || key === "") continue;
      workspaceDirs.push(key);
      for (const name of declaredNames(pkg)) direct.add(name);
    }
    for (const name of declaredNames(lock.packages[""])) direct.add(name);
    const topLevelPrefixes = ["", ...workspaceDirs.map((d) => `${d}/`)];

    for (const [key, pkg] of Object.entries(lock.packages)) {
      const idx = key.lastIndexOf(NODE_MODULES);
      if (idx === -1 || pkg.link || !pkg.version || isNonRegistryVersion(pkg.version)) continue;
      const name = pkg.name ?? key.slice(idx + NODE_MODULES.length);
      const parent = key.slice(0, idx);
      const isTopLevel = topLevelPrefixes.includes(parent);
      out.push({ name, version: pkg.version, direct: isTopLevel && direct.has(name) });
    }
    return out;
  }

  // lockfileVersion 1: nested `dependencies` tree.
  const walk = (deps: Record<string, NpmLockV1Dependency>, depth: number) => {
    for (const [name, dep] of Object.entries(deps)) {
      if (dep.version && !isNonRegistryVersion(dep.version)) {
        out.push({ name, version: dep.version, direct: depth === 0 && direct.has(name) });
      }
      if (dep.dependencies) walk(dep.dependencies, depth + 1);
    }
  };
  walk(lock.dependencies ?? {}, 0);
  return out;
}
