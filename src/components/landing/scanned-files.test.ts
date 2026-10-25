import { describe, expect, it } from "vitest";

import { scannedFileList, scannedFilesText } from "./scanned-files";

// The landing page's "files it reads" list comes from the scanner's own lists. A change to
// what the scanner reads changes this text: review it, then update the snapshot.

describe("landing: the files Briff reads", () => {
  it("matches the scanner's lists", () => {
    expect(scannedFilesText()).toMatchSnapshot();
  });

  it("starts with the lockfiles and never lists a source or env file", () => {
    const { names } = scannedFileList();
    expect(names.slice(0, 4)).toEqual([
      "package-lock.json",
      "npm-shrinkwrap.json",
      "pnpm-lock.yaml",
      "yarn.lock",
    ]);
    expect(names.some((n) => /\.(ts|js|php|py|go|rb|env)$|^\.env/.test(n))).toBe(false);
  });
});
