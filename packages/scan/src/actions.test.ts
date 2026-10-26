import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseActions, WORKFLOW_PATH } from "./actions";

const fixture = readFileSync(
  new URL("./__fixtures__/actions/workflow.yml", import.meta.url),
  "utf8"
);

describe("workflow uses references", () => {
  it("keeps floating majors distinct from exact releases and retains SHA evidence", () => {
    const rows = parseActions(fixture, ".github/workflows/check.yml");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ name: "actions/checkout", version: "v4", constraint: true });
    expect(rows[1]).toMatchObject({
      name: "tj-actions/changed-files",
      version: "v45.0.7",
      constraint: false,
      metadata: { sha: "6cb76d07bee4c9772c6882c06c37837bf82a04d3" },
    });
    expect(rows[2].metadata.subpath).toBe("sub-action");
    expect(rows[3]).toMatchObject({
      name: "acme/workflows",
      metadata: { subpath: ".github/workflows/check.yml" },
    });
  });

  it("reads quoted refs and unannotated SHAs without guessing a release", () => {
    expect(parseActions(`- uses: 'acme/tool@v1.2.3' # release`, "ci.yml")[0].version).toBe(
      "v1.2.3"
    );
    const sha = "a".repeat(40);
    expect(parseActions(`uses: acme/tool@${sha}`, "ci.yml")[0]).toMatchObject({
      version: sha,
      metadata: { sha },
    });
    expect(
      parseActions(
        "# uses: acme/tool@v1\nrun: |\n  echo uses: acme/tool@v1\n  uses: acme/tool@v2",
        "ci.yml"
      )
    ).toEqual([]);
    expect(parseActions("uses: acme/tool@${{ inputs.ref }}", "ci.yml")).toEqual([]);
  });

  it("limits workflow discovery to the repository workflow directory", () => {
    for (const path of [".github/workflows/ci.yml", ".github/workflows/release.yaml"])
      expect(WORKFLOW_PATH.test(path)).toBe(true);
    for (const path of [".github/actions/ci.yml", ".github/workflows/nested/ci.yml", "ci.yml"])
      expect(WORKFLOW_PATH.test(path)).toBe(false);
  });
});
