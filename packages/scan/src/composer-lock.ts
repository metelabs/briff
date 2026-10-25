import { normalizePackageName, normalizeVersion } from "./ecosystems";
import type { LockedDependency } from "./types";

interface ComposerLockPackage {
  name?: string;
  version?: string;
}

interface ComposerLock {
  packages?: ComposerLockPackage[];
  "packages-dev"?: ComposerLockPackage[];
}

interface ComposerManifest {
  require?: Record<string, string>;
  "require-dev"?: Record<string, string>;
}

/**
 * Branch installs (`dev-main`, `2.x-dev`) name no release, so OSV cannot place them;
 * they are skipped like npm links.
 */
function isBranchVersion(version: string): boolean {
  return /^dev-/i.test(version) || /-dev$/i.test(version);
}

/** What a composer.json requires, names lower-cased; platform entries (`php`, `ext-*`) left out. */
export interface ComposerDeclared {
  require: string[];
  requireDev: string[];
}

const NONE: ComposerDeclared = { require: [], requireDev: [] };

/** `require` and `require-dev` of a composer.json; empty when absent or invalid. */
export function composerDeclared(manifest: string | null): ComposerDeclared {
  if (manifest === null) return NONE;
  try {
    const parsed = JSON.parse(manifest) as ComposerManifest;
    const names = (section: Record<string, string> | undefined) =>
      Object.keys(section ?? {})
        .filter((name) => name.includes("/"))
        .map((name) => normalizePackageName("Packagist", name));
    return { require: names(parsed.require), requireDev: names(parsed["require-dev"]) };
  } catch {
    return NONE;
  }
}

/**
 * Parses composer.lock (`packages` and `packages-dev`) into installed versions. Direct
 * means required by the sibling composer.json; `dev` means required only in `require-dev`,
 * so a fix command keeps it there (`composer require --dev`). Platform entries (`php`,
 * `ext-*`) are not packages and never appear in the lock's package lists.
 */
export function parseComposerLock(content: string, declared: ComposerDeclared): LockedDependency[] {
  const lock = JSON.parse(content) as ComposerLock;
  const prod = new Set(declared.require);
  const dev = new Set(declared.requireDev);
  const out: LockedDependency[] = [];
  for (const pkg of [...(lock.packages ?? []), ...(lock["packages-dev"] ?? [])]) {
    if (!pkg.name || !pkg.version || isBranchVersion(pkg.version)) continue;
    const name = normalizePackageName("Packagist", pkg.name);
    const devOnly = dev.has(name) && !prod.has(name);
    out.push({
      name,
      version: normalizeVersion("Packagist", pkg.version),
      direct: prod.has(name) || devOnly,
      ecosystem: "Packagist",
      ...(devOnly ? { dev: true as const } : {}),
    });
  }
  return out;
}
