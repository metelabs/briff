import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import scanPackage from "../../../packages/scan/package.json";

import { localScanCommands, SCANNER_MAJOR, scanWorkflowYaml } from "./workflow";

describe("scan workflow template", () => {
  const yaml = scanWorkflowYaml("https://app.briff.dev");

  it("pins the package's major and names its current version", () => {
    expect(SCANNER_MAJOR).toBe(scanPackage.version.split(".")[0]);
    expect(yaml).toContain(`- run: npx briff-scan@${SCANNER_MAJOR}\n`);
    expect(yaml).toContain(`briff-scan ${scanPackage.version}`);
  });

  it("is a valid workflow that reads the token from the repo secret", () => {
    const doc = parse(yaml) as {
      name: string;
      on: { push: { branches: string[] }; schedule: { cron: string }[] };
      jobs: {
        scan: {
          steps: {
            uses?: string;
            run?: string;
            with?: Record<string, unknown>;
            env?: Record<string, string>;
          }[];
        };
      };
    };
    expect(doc.name).toBe("briff");
    expect(doc.on.push.branches).toEqual(["main"]);
    expect(doc.on.schedule).toEqual([{ cron: "0 3 * * 1" }]);
    // The newest 22.x on every run, not a lagging toolcache Node; the major floats.
    const uses = doc.jobs.scan.steps.flatMap((s) => (s.uses ? [s.uses] : []));
    expect(uses).toEqual(["actions/checkout@v5", "actions/setup-node@v5"]);
    const node = doc.jobs.scan.steps.find((s) => s.uses?.startsWith("actions/setup-node"));
    expect(node?.with).toEqual({
      "node-version": 22,
      "check-latest": true,
      "package-manager-cache": false,
    });
    const step = doc.jobs.scan.steps.find((s) => s.run);
    expect(step?.env).toEqual({
      BRIFF_API_URL: "https://app.briff.dev",
      BRIFF_TOKEN: "${{ secrets.BRIFF_TOKEN }}",
    });
  });

  it("is the one documented in docs/SCANNER.md", () => {
    const doc = readFileSync(path.join(__dirname, "../../../docs/SCANNER.md"), "utf8");
    expect(doc).toContain("```yaml\n" + yaml + "```");
  });

  it("builds the local commands around the token", () => {
    expect(localScanCommands("http://localhost:3000", "brf_x")).toEqual({
      dryRun: `npx briff-scan@${SCANNER_MAJOR} --dry-run`,
      upload: `BRIFF_API_URL=http://localhost:3000 BRIFF_TOKEN=brf_x npx briff-scan@${SCANNER_MAJOR}`,
      allRepos: `BRIFF_API_URL=http://localhost:3000 BRIFF_TOKEN=brf_x npx briff-scan@${SCANNER_MAJOR} --all-repos --root ~/code`,
    });
  });
});
