import { fixedFor } from "@/security/plan";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { collectFromFiles } from "@scan/collect";
import { ecosystemLabel } from "@scan/ecosystems";
import { dedupeDependencies } from "@/lib/scan/ingest";
import { fixCommand } from "@/pipeline/fixes";

import { actionTags } from "./github-actions";
import { actionConstraintAffected, osvQueryOf, osvVulnSchema, toAdvisoryFields } from "./osv";

const recorded = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`./__fixtures__/github-actions/${name}.json`, import.meta.url), "utf8")
  );
const advisory = osvVulnSchema.parse(recorded("changed-files"));

describe("GitHub Actions coverage", () => {
  it("uses the same workflow parser for uploaded and GitHub App files", async () => {
    const workflow = readFileSync(
      new URL("../../packages/scan/src/__fixtures__/actions/workflow.yml", import.meta.url),
      "utf8"
    );
    const repo = await collectFromFiles(
      "acme/web",
      { ".github/workflows/check.yml": workflow, ".github/ignored.yml": "uses: acme/ignored@v1" },
      { warn: () => undefined }
    );
    expect(repo?.dependencies).toHaveLength(4);
    const rows = dedupeDependencies(repo?.dependencies ?? []);
    expect(rows[0]).toMatchObject({
      ecosystem: "GitHub Actions",
      name: "acme/tool",
      metadata: { subpath: "sub-action" },
    });
    expect(rows.find((row) => row.name === "actions/checkout")?.constraint).toBe(true);
    expect(ecosystemLabel("GitHub Actions")).toBe("Actions");
  });

  it("never sends a floating major as an exact OSV version", () => {
    expect(
      osvQueryOf({
        ecosystem: "GitHub Actions",
        name: "actions/checkout",
        version: "v4",
        constraint: true,
      })
    ).toEqual({ package: { ecosystem: "GitHub Actions", name: "actions/checkout" } });
    const sha = "a".repeat(40);
    expect(
      osvQueryOf({ ecosystem: "GitHub Actions", name: "acme/action", version: sha })
    ).toMatchObject({ commit: sha });
    expect(actionConstraintAffected(advisory, "tj-actions/changed-files", "v45")).toBe(true);
    expect(actionConstraintAffected(advisory, "tj-actions/changed-files", "v46")).toBe(false);
    expect(actionConstraintAffected(advisory, "actions/checkout", "v45")).toBe(false);
  });

  it("never recommends the next major even when the recorded advisory fixes only that major", () => {
    const fields = toAdvisoryFields(advisory, "tj-actions/changed-files", "GitHub Actions");
    expect(fields.fixedVersion).toBe("46.0.1");
    expect(
      fixCommand("tj-actions/changed-files", null, [
        {
          repo: "acme/web",
          installed: "v45.0.7",
          fix: fields.fixedVersion,
          ecosystem: "GitHub Actions",
        },
      ])
    ).toBeNull();
  });

  it("pins an on-line fix to the SHA recorded by the tags API when available", () => {
    const tags = actionTags(recorded("checkout-tags"));
    expect(Object.keys(tags).length).toBeGreaterThan(0);
    const sha = "a".repeat(40);
    expect(
      fixCommand("acme/action", null, [
        {
          repo: "acme/web",
          installed: "v4.1.0",
          fix: "4.2.1",
          ecosystem: "GitHub Actions",
          actionTags: { "4.2.1": sha },
        },
      ])
    ).toBe(`pin acme/action to v4.2.1 (sha ${sha})`);
  });
});

it("keeps an Actions security email on the installed line", () => {
  const fields = toAdvisoryFields(advisory, "tj-actions/changed-files", "GitHub Actions");
  expect(
    fixedFor({
      osvId: advisory.id,
      packageName: "tj-actions/changed-files",
      summary: null,
      severity: "HIGH",
      affected: fields.affected,
      fallbackFixed: fields.fixedVersion,
      ecosystem: "GitHub Actions",
      repos: [{ name: "acme/web", installedVersion: "v45.0.7", direct: true }],
    })
  ).toBe("read the advisory");
});
