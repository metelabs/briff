import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// The CI triggers decide which changes get checked. Release PRs (opened by release-please with
// GITHUB_TOKEN) must create no run: GitHub would hold it for approval and let it expire red.
// Every other change must still be checked, before or after the merge.

interface Triggers {
  pull_request?: { "paths-ignore"?: string[] };
  push?: { branches?: string[]; paths?: string[] };
  workflow_dispatch?: unknown;
}

const ROOT = join(__dirname, "..", "..");
const workflow = parse(readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
  on: Triggers;
};
const triggers = workflow.on;

// Files a release PR changes (release-please `node` release type), as seen in its PRs.
const RELEASE_PR_FILES = [
  "CHANGELOG.md",
  ".release-please-manifest.json",
  "package.json",
  "package-lock.json",
];

/** GitHub's rule for these literal patterns: a PR runs unless every file is ignored. */
function pullRequestRuns(files: readonly string[]): boolean {
  const ignored = triggers.pull_request?.["paths-ignore"] ?? [];
  return files.some((f) => !ignored.includes(f));
}

/** A push runs when it targets a listed branch and changes a listed path. */
function pushRuns(branch: string, files: readonly string[]): boolean {
  const push = triggers.push;
  if (!push?.branches?.includes(branch)) return false;
  return files.some((f) => push.paths?.includes(f) ?? true);
}

describe("CI workflow triggers", () => {
  it("uses literal paths only, so the matching above is GitHub's", () => {
    for (const path of [
      ...(triggers.pull_request?.["paths-ignore"] ?? []),
      ...(triggers.push?.paths ?? []),
    ])
      expect(path).not.toMatch(/[*?[\]!]/);
  });

  it("creates no run for a release PR", () => {
    expect(pullRequestRuns(RELEASE_PR_FILES)).toBe(false);
    expect(pullRequestRuns(["CHANGELOG.md"])).toBe(false);
  });

  it("checks every PR that changes anything else", () => {
    expect(pullRequestRuns([...RELEASE_PR_FILES, "src/security/scan.ts"])).toBe(true);
    expect(pullRequestRuns(["src/app/alerts/page.tsx"])).toBe(true);
    expect(pullRequestRuns([".github/workflows/ci.yml"])).toBe(true);
  });

  it("checks a dependency-only change on main after the merge", () => {
    expect(pullRequestRuns(["package.json", "package-lock.json"])).toBe(false);
    expect(pushRuns("main", ["package.json", "package-lock.json"])).toBe(true);
    expect(pushRuns("main", ["package-lock.json"])).toBe(true);
    expect(pushRuns("main", ["src/app/page.tsx"])).toBe(false);
    expect(pushRuns("release-please--branches--main", ["package.json"])).toBe(false);
  });

  it("keeps the manual trigger", () => {
    expect("workflow_dispatch" in triggers).toBe(true);
  });
});
