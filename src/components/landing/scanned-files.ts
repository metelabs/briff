import { MAX_DEPTH, SCANNED_FILE_NAMES, SCANNED_NAME_PATTERNS } from "@scan/files";
import { LOCKFILES, lockfileKind, SKIP_DIRS } from "@scan/discover";

// The file list the landing page shows, straight from the scanner's own lists (the ones the
// GitHub App filters the tree with), so the page cannot promise less or more than it reads.

export interface ScannedFileList {
  names: readonly string[];
  patterns: readonly string[];
  skippedDirs: readonly string[];
  maxDepth: number;
  groups: { label: string; files: string[] }[];
}

const GROUPS: Record<string, string> = {
  npm: "npm / pnpm / yarn",
  pnpm: "npm / pnpm / yarn",
  yarn: "npm / pnpm / yarn",
  composer: "Composer",
  poetry: "PyPI",
  uv: "PyPI",
  pipenv: "PyPI",
  requirements: "PyPI",
  gomod: "Go modules",
  bundler: "RubyGems / Bundler",
  cargo: "crates.io / Cargo",
  maven: "Maven / Gradle",
  nuget: "NuGet",
  pub: "pub / Dart / Flutter",
  swift: "SwiftPM",
  hex: "Hex / Elixir",
};

export function scannedFileList(): ScannedFileList {
  const groups = new Map<string, string[]>();
  const add = (label: string, file: string) =>
    groups.set(label, [...(groups.get(label) ?? []), file]);
  for (const name of SCANNED_FILE_NAMES) {
    const kind = LOCKFILES[name] ?? (name === "Gemfile" ? "bundler" : null);
    add(kind ? GROUPS[kind] : "Runtime versions / containers", name);
  }
  for (const { pattern, example } of SCANNED_NAME_PATTERNS) {
    const kind = lockfileKind(example);
    add(kind ? GROUPS[kind] : "Runtime versions / containers", pattern);
  }
  add("GitHub Actions", ".github/workflows/*.yml|yaml (uses only)");
  return {
    names: SCANNED_FILE_NAMES,
    patterns: [
      ...SCANNED_NAME_PATTERNS.map((p) => p.pattern),
      ".github/workflows/*.yml|yaml (uses only)",
    ],
    skippedDirs: [...SKIP_DIRS],
    maxDepth: MAX_DEPTH,
    groups: [...groups].map(([label, files]) => ({ label, files })),
  };
}

/** The list as plain text, as the page words it (snapshot-tested). */
export function scannedFilesText(list: ScannedFileList = scannedFileList()): string {
  return [
    `Files: ${list.names.join(", ")}`,
    `Patterns: ${list.patterns.join(", ")}`,
    ...list.groups.map((g) => `${g.label}: ${g.files.join(", ")}`),
    `At most ${list.maxDepth} directories deep; never inside ${list.skippedDirs.join(", ")} or a directory starting with a dot (except .github/workflows uses lines).`,
  ].join("\n");
}
