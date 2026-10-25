import { parse } from "yaml";

import { isNonRegistryVersion, splitNameVersion } from "./package-name";
import type { LockedDependency } from "./types";

interface ImporterDependency {
  specifier?: string;
  version?: string;
}

type ImporterDeps = Record<string, ImporterDependency | string>;

interface PnpmImporter {
  dependencies?: ImporterDeps;
  devDependencies?: ImporterDeps;
  optionalDependencies?: ImporterDeps;
}

interface PnpmLockfile {
  lockfileVersion?: string | number;
  importers?: Record<string, PnpmImporter>;
  packages?: Record<string, unknown>;
  // Lockfiles without workspaces before v9 keep deps at the top level.
  dependencies?: ImporterDeps;
  devDependencies?: ImporterDeps;
  optionalDependencies?: ImporterDeps;
}

/** "1.2.3(react@18.0.0)" -> "1.2.3"; v5/v6 also used "1.2.3_react@18.0.0". */
function cleanVersion(raw: string, legacy: boolean): string {
  let version = raw.split("(")[0];
  if (legacy) version = version.split("_")[0];
  return version.trim();
}

/** Package keys: v9 "name@1.0.0", v6 "/name@1.0.0", v5 "/name/1.0.0". */
export function parsePnpmPackageKey(
  key: string,
  legacy: boolean
): { name: string; version: string } | null {
  const trimmed = key.startsWith("/") ? key.slice(1) : key;
  const base = trimmed.split("(")[0];
  // v5 "name/1.0.0_peer@2": try the slash form first, the "_peer" tail may contain "@".
  const slash = base.lastIndexOf("/");
  if (legacy && slash > 0 && /^\d/.test(base.slice(slash + 1))) {
    return { name: base.slice(0, slash), version: cleanVersion(base.slice(slash + 1), legacy) };
  }
  const viaAt = splitNameVersion(base);
  if (viaAt && /^\d/.test(viaAt.version)) {
    return { name: viaAt.name, version: cleanVersion(viaAt.version, legacy) };
  }
  return null;
}

function importerEntries(deps: ImporterDeps | undefined): [string, string][] {
  if (!deps) return [];
  return Object.entries(deps).flatMap(([name, value]) => {
    const version = typeof value === "string" ? value : value.version;
    return version ? [[name, version] as [string, string]] : [];
  });
}

/** Parses pnpm-lock.yaml, including every workspace importer. */
export function parsePnpmLock(content: string): LockedDependency[] {
  const lock = (parse(content) ?? {}) as PnpmLockfile;
  const major = Number.parseFloat(String(lock.lockfileVersion ?? "9"));
  const legacy = major < 9;

  const importers: PnpmImporter[] = lock.importers
    ? Object.values(lock.importers)
    : [
        {
          dependencies: lock.dependencies,
          devDependencies: lock.devDependencies,
          optionalDependencies: lock.optionalDependencies,
        },
      ];

  const directKeys = new Set<string>();
  for (const importer of importers) {
    for (const deps of [
      importer.dependencies,
      importer.devDependencies,
      importer.optionalDependencies,
    ]) {
      for (const [name, rawVersion] of importerEntries(deps)) {
        if (isNonRegistryVersion(rawVersion)) continue;
        directKeys.add(`${name}@${cleanVersion(rawVersion, legacy)}`);
      }
    }
  }

  const seen = new Set<string>();
  const out: LockedDependency[] = [];
  for (const key of Object.keys(lock.packages ?? {})) {
    const parsed = parsePnpmPackageKey(key, legacy);
    if (!parsed) continue;
    const id = `${parsed.name}@${parsed.version}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ ...parsed, direct: directKeys.has(id) });
  }
  return out;
}
