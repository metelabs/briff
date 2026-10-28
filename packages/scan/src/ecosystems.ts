import { swiftPackageName } from "./swift-url";

// Package ecosystems, named as OSV names them (https://ossf.github.io/osv-schema/#affectedpackage-field):
// the same string is `Package.ecosystem` in Briff and the `ecosystem` of an OSV query.

export const ECOSYSTEMS = [
  "npm",
  "Packagist",
  "PyPI",
  "Go",
  "RubyGems",
  "crates.io",
  "Maven",
  "NuGet",
  "Pub",
  "SwiftURL",
  "Hex",
  "GitHub Actions",
] as const;

export type Ecosystem = (typeof ECOSYSTEMS)[number];

/**
 * The tool a Python lockfile belongs to, so a fix command speaks it (`uv lock`, `poetry add`,
 * `pipenv install`, `pip install` for a requirements file). Other ecosystems have one tool.
 */
export const PACKAGE_MANAGERS = ["pip", "poetry", "uv", "pipenv", "maven", "gradle"] as const;

export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

export function isEcosystem(value: string): value is Ecosystem {
  return (ECOSYSTEMS as readonly string[]).includes(value);
}

/** A stored `Package.ecosystem` as an Ecosystem; undefined for a value this build does not know. */
export function asEcosystem(value: string | null | undefined): Ecosystem | undefined {
  return value && isEcosystem(value) ? value : undefined;
}

/** A stored `Dependency.manager` as a PackageManager; undefined when absent or unknown. */
export function asPackageManager(value: string | null | undefined): PackageManager | undefined {
  return value && (PACKAGE_MANAGERS as readonly string[]).includes(value)
    ? (value as PackageManager)
    : undefined;
}

/** How one row declares a package, for mergeDeclarations. */
export interface DeclarationFlags {
  direct: boolean;
  dev?: boolean | null;
  group?: string | null;
}

/**
 * Two rows of one pin, merged: every section either declares (`.` the main list, a group,
 * `extra:<name>`) is kept, so each gets its fix. Development-only while no row declares the
 * package for production. Rows without sections (npm, Composer) merge their dev flag only.
 */
export function mergeDeclarations(
  a: DeclarationFlags,
  b: DeclarationFlags
): { dev: boolean; group: string | undefined } {
  const prodDirect = (d: DeclarationFlags) => d.direct && !d.dev;
  if (!a.group && !b.group) {
    return { dev: Boolean(a.dev || b.dev) && !prodDirect(a) && !prodDirect(b), group: undefined };
  }
  const sections = (d: DeclarationFlags): string[] =>
    d.group ? d.group.split(",") : !d.direct ? [] : d.dev ? ["dev"] : ["."];
  const all = [...new Set([...sections(a), ...sections(b)])];
  const devOnly = all.length > 0 && all.every((s) => s !== "." && !s.startsWith("extra:"));
  return {
    dev: devOnly,
    group: all.length === 0 || (all.length === 1 && all[0] === ".") ? undefined : all.join(","),
  };
}

/**
 * A row's `requirement`: each declaration's shape (extras and marker, no version) by its
 * target (a section, or `member:section` in a uv workspace), one `target<TAB>shape` per line.
 */
export function encodeShapes(entries: readonly (readonly [string, string])[]): string {
  return entries.map(([target, shape]) => `${target}\t${shape}`).join("\n");
}

/**
 * The shapes for one target of an encoded `requirement`: one per declaration (a section can
 * declare one pin twice, per platform). A plain shape (no target) applies to every target.
 */
export function shapesFor(requirement: string | undefined, target: string): string[] {
  if (!requirement) return [];
  if (!requirement.includes("\t")) return [requirement];
  return requirement.split("\n").flatMap((line) => {
    const tab = line.indexOf("\t");
    return line.slice(0, tab) === target ? [line.slice(tab + 1)] : [];
  });
}

/** What the UI calls an ecosystem: the tool people know (`Composer`), not OSV's registry name. */
export function ecosystemLabel(ecosystem: string): string {
  // OSV's names read well as they are, except Packagist: people know the tool.
  switch (ecosystem) {
    case "Packagist":
      return "Composer";
    case "SwiftURL":
      return "SwiftPM";
    case "GitHub Actions":
      return "Actions";
    default:
      return ecosystem;
  }
}

/**
 * The name Briff stores. Composer names are case-insensitive (Composer lower-cases them);
 * PyPI names are normalised per PEP 503 (`Flask_SQLAlchemy` and `flask-sqlalchemy` are one
 * project); npm names and Go module paths (case-sensitive) are kept as written.
 */
export function normalizePackageName(ecosystem: Ecosystem, name: string): string {
  const trimmed = name.trim();
  switch (ecosystem) {
    case "SwiftURL":
      return swiftPackageName(trimmed) ?? trimmed;
    case "Hex":
    case "Pub":
    case "NuGet":
    case "Packagist":
    case "GitHub Actions":
      return trimmed.toLowerCase();
    case "PyPI":
      return trimmed.toLowerCase().replace(/[-_.]+/g, "-");
    case "Maven":
    case "crates.io":
    case "RubyGems":
    case "npm":
    case "Go":
      return trimmed;
  }
}

const TWO_PART = /^\d+\.\d+$/;

// PEP 440 public versions with at most three release numbers and an optional pre-release:
// `2.31`, `1.0rc1`, `2.0.0b3`, `v1.2-alpha.2`. Epochs, post, dev and local versions do not
// fit semver's ordering and are kept as written.
const PEP440 =
  /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-_.]?(a|b|c|rc|alpha|beta|pre|preview)[-_.]?(\d*))?$/i;

const PRE_LABEL: Readonly<Record<string, string>> = {
  a: "a",
  alpha: "a",
  b: "b",
  beta: "b",
  c: "rc",
  rc: "rc",
  pre: "rc",
  preview: "rc",
};

/**
 * The installed version Briff stores, in the form its version comparisons (semver) read,
 * when that form means the same release to the ecosystem's own tooling: Composer treats
 * `v6.4.3`, `6.4.3` and `6.4` / `6.4.0` alike; PEP 440 pads release numbers with zeros
 * (`2.31` is `2.31.0`) and spells pre-releases several ways (`1.0rc1` is `1.0.0-rc.1`;
 * semver orders `a` < `b` < `rc` as PEP 440 does); Go module versions are semver with a `v`
 * that OSV leaves out (`v0.30.0` is `0.30.0`, pseudo-versions included). Anything else is
 * kept as written.
 */
export function normalizeVersion(ecosystem: Ecosystem, version: string): string {
  const raw = version.trim();
  switch (ecosystem) {
    case "Packagist": {
      const bare = raw.replace(/^v(?=\d)/i, "");
      return TWO_PART.test(bare) ? `${bare}.0` : bare;
    }
    case "PyPI": {
      const m = PEP440.exec(raw);
      if (!m) return raw;
      const [, major, minor = "0", patch = "0", label, number] = m;
      const release = [major, minor, patch].map((n) => String(Number(n))).join(".");
      return label
        ? `${release}-${PRE_LABEL[label.toLowerCase()]}.${Number(number || "0")}`
        : release;
    }
    case "Go":
      return raw.replace(/^v(?=\d)/, "");
    case "SwiftURL":
    case "Hex":
    case "Pub":
    case "NuGet":
    case "Maven":
    case "crates.io":
    case "RubyGems":
    case "npm":
    case "GitHub Actions":
      return raw;
  }
}
