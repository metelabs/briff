import { describe, expect, it } from "vitest";

import { parseCliArgs } from "../packages/scan/src/args";

import { scanLocalArgs } from "./scan-local-args";

describe("scanLocalArgs", () => {
  it("scans ~/code (or BRIFF_SCAN_ROOT) unless --root is given", () => {
    expect(scanLocalArgs(["--dry-run"], {})).toEqual([
      "--all-repos",
      "--root",
      "~/code",
      "--dry-run",
    ]);
    expect(scanLocalArgs([], { BRIFF_SCAN_ROOT: "/srv/code" })).toEqual([
      "--all-repos",
      "--root",
      "/srv/code",
    ]);
    expect(scanLocalArgs(["--root=/x"], { BRIFF_SCAN_ROOT: "/srv/code" })).toEqual([
      "--all-repos",
      "--root=/x",
    ]);
  });

  it("forwards BRIFF_SCAN_EXCLUDE as --exclude, next to flags given by hand", () => {
    const argv = scanLocalArgs(["--exclude", "c", "--dry-run"], {
      BRIFF_SCAN_EXCLUDE: " briff, sigma/forms-web ",
    });
    expect(argv).toEqual([
      "--all-repos",
      "--root",
      "~/code",
      "--exclude",
      "briff, sigma/forms-web",
      "--exclude",
      "c",
      "--dry-run",
    ]);
    const parsed = parseCliArgs(argv, {}, "/home/u");
    expect(parsed.kind === "run" && parsed.options.exclude).toEqual([
      "briff",
      "sigma/forms-web",
      "c",
    ]);
    expect(scanLocalArgs([], { BRIFF_SCAN_EXCLUDE: " " })).not.toContain("--exclude");
  });
});
