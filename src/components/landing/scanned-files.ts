import { MAX_DEPTH, SCANNED_FILE_NAMES, SCANNED_NAME_PATTERNS } from "@scan/files";
import { SKIP_DIRS } from "@scan/discover";

// The file list the landing page shows, straight from the scanner's own lists (the ones the
// GitHub App filters the tree with), so the page cannot promise less or more than it reads.

export interface ScannedFileList {
  names: readonly string[];
  patterns: readonly string[];
  skippedDirs: readonly string[];
  maxDepth: number;
}

export function scannedFileList(): ScannedFileList {
  return {
    names: SCANNED_FILE_NAMES,
    patterns: SCANNED_NAME_PATTERNS.map((p) => p.pattern),
    skippedDirs: [...SKIP_DIRS],
    maxDepth: MAX_DEPTH,
  };
}

/** The list as plain text, as the page words it (snapshot-tested). */
export function scannedFilesText(list: ScannedFileList = scannedFileList()): string {
  return [
    `Files: ${list.names.join(", ")}`,
    `Patterns: ${list.patterns.join(", ")}`,
    `At most ${list.maxDepth} directories deep; never inside ${list.skippedDirs.join(", ")} or a directory starting with a dot.`,
  ].join("\n");
}
