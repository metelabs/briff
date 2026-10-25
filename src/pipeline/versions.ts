// Version strings in release titles ("vercel/next.js v16.4.1", "expo@54.0.0-canary.3",
// "## 2.1.0"). Pure helpers for pre-release detection and release folding.

const PRE_RELEASE =
  /\d-(?:canary|beta|alpha|rc|next|nightly|dev|prerelease|preview|experimental|insiders)(?=[.\d+\s)]|$|-)/i;
// "TypeScript 7.1 Beta", "Vite 8.0 RC1": a whole-word marker, trusted only next to a version
// number so "Introducing the beta of Expo Router 5" stays with the model.
const PRE_RELEASE_WORD =
  /(?<![\p{L}\p{N}])(?:beta|alpha|rc\d*|preview|prerelease|canary|nightly)(?![\p{L}\p{N}])/iu;
const VERSION_NUMBER = /\d+\.\d+/;

/**
 * True when a title names a pre-release version: a hyphenated tag (`-canary`, `-beta`,
 * `-preview`, `-prerelease`, ...) or a whole-word marker (Beta, RC1) in a title with a version.
 */
export function isPreRelease(title: string): boolean {
  return PRE_RELEASE.test(title) || (VERSION_NUMBER.test(title) && PRE_RELEASE_WORD.test(title));
}

export const PRE_RELEASE_REASON = "pre-release";

// Monorepo CI tags such as "baml-language-source-481d0742...e1e4d" name a commit, not a version.
const SHA_TAG = /(?:^|[^0-9A-Za-z])[0-9a-f]{40}(?![0-9A-Za-z])/i;

/** True when a title carries a bare 40-hex commit sha (a CI tag, not a release version). */
export function isShaTag(title: string): boolean {
  return SHA_TAG.test(title);
}

export const SHA_TAG_REASON = "sha-tag";

/** Why a title is `minor` by rule without asking the model, or null when the model decides. */
export function ruleMinorReason(title: string): string | null {
  if (isPreRelease(title)) return PRE_RELEASE_REASON;
  if (isShaTag(title)) return SHA_TAG_REASON;
  return null;
}

const VERSION = /(?:^|[^0-9A-Za-z.])v?(\d+(?:\.\d+){1,3})(-[0-9A-Za-z.]+)?(?![0-9A-Za-z])/g;

export interface ParsedVersion {
  text: string;
  parts: number[];
  pre: string | null;
}

/** The last version-looking token in a title (tags come after the repo slug). */
export function extractVersion(title: string): ParsedVersion | null {
  let last: RegExpExecArray | null = null;
  for (const m of title.matchAll(VERSION)) last = m;
  if (!last) return null;
  return {
    text: `${last[1]}${last[2] ?? ""}`,
    parts: last[1].split(".").map(Number),
    pre: last[2] ? last[2].slice(1) : null,
  };
}

/** Semver-ish order: numeric parts, then a release ranks above its pre-releases. */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  const len = Math.max(a.parts.length, b.parts.length);
  for (let i = 0; i < len; i++) {
    const diff = (a.parts[i] ?? 0) - (b.parts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (a.pre === b.pre) return 0;
  if (a.pre === null) return 1;
  if (b.pre === null) return -1;
  return a.pre.localeCompare(b.pre, "en", { numeric: true });
}
