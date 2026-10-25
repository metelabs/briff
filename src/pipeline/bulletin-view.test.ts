import { describe, expect, it } from "vitest";

import { advisoryCount, alertLinesOf, mergeFixedLists, type AlertRow } from "./bulletin-view";

const range = (introduced: string, fixed: string) => ({
  type: "SEMVER",
  events: [{ introduced }, { fixed }],
});

const row = (
  pkg: string,
  osvId: string,
  repo: string,
  over: Partial<AlertRow["advisory"]> & { installed?: string[] } = {}
): AlertRow => {
  const { installed = [], ...advisory } = over;
  return {
    repo: { name: repo },
    installedVersions: installed,
    direct: true,
    advisory: {
      osvId,
      severity: "HIGH",
      affected: [],
      fixedVersion: null,
      package: { name: pkg },
      ...advisory,
    },
  };
};

describe("alertLinesOf", () => {
  it("lists one line per package with its advisories, repos merged", () => {
    const out = alertLinesOf([
      row("undici", "GHSA-1", "budget"),
      row("undici", "GHSA-1", "pantheon"),
      row("undici", "GHSA-2", "tracker", { severity: "CRITICAL" }),
      row("zod", "GHSA-3", "budget", { severity: "LOW" }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      packageName: "undici",
      severity: "CRITICAL",
      osvIds: ["GHSA-2", "GHSA-1"],
      repos: ["budget", "pantheon", "tracker"],
    });
    expect(out[1]).toMatchObject({ packageName: "zod", osvIds: ["GHSA-3"] });
    expect(advisoryCount(out)).toBe(3);
  });

  it("merges two handlebars advisories with the same fix into one line", () => {
    const affected = [range("4.0.0", "4.7.10")];
    const out = alertLinesOf([
      row("handlebars", "GHSA-a", "sigma/forms-web", {
        severity: "CRITICAL",
        affected,
        fixedVersion: "4.7.10",
        installed: ["4.7.8"],
      }),
      row("handlebars", "GHSA-b", "sigma/forms-web", {
        severity: "CRITICAL",
        affected,
        fixedVersion: "4.7.10",
        installed: ["4.7.8"],
      }),
    ]);
    expect(out).toEqual([
      {
        packageName: "handlebars",
        severity: "CRITICAL",
        osvIds: ["GHSA-a", "GHSA-b"],
        repos: ["sigma/forms-web"],
        fixed: "4.7.10",
        noLineFix: false,
        transitive: false,
        installs: [
          {
            repo: "sigma/forms-web",
            name: "handlebars",
            installed: ["4.7.8"],
            target: "4.7.10",
          },
        ],
      },
    ]);
  });

  it("gives next one fix per installed line: the highest of its advisories", () => {
    const out = alertLinesOf([
      row("next", "GHSA-n1", "sigma/forms-web", {
        severity: "CRITICAL",
        affected: [range("15.0.0", "15.5.7"), range("16.0.0", "16.0.7")],
        fixedVersion: "15.5.7, 16.0.7",
        installed: ["15.5.4"],
      }),
      row("next", "GHSA-n2", "sigma/forms-web", {
        severity: "CRITICAL",
        affected: [range("15.0.0", "15.5.9")],
        fixedVersion: "15.5.9",
        installed: ["15.5.4"],
      }),
      row("next", "GHSA-n3", "sigma/tracker", {
        severity: "HIGH",
        affected: [range("16.0.0", "16.0.10")],
        fixedVersion: "16.0.10",
        installed: ["16.0.3"],
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      osvIds: ["GHSA-n1", "GHSA-n2", "GHSA-n3"],
      repos: ["sigma/forms-web", "sigma/tracker"],
      fixed: "16.0.10 (sigma/tracker) · 15.5.9 (sigma/forms-web)",
    });
  });

  it("never offers a fix on a higher major for a known installed version", () => {
    const out = alertLinesOf([
      row("next", "GHSA-major", "garden", {
        severity: "CRITICAL",
        affected: [range("15.0.0", "16.0.7")],
        fixedVersion: "16.0.7",
        installed: ["15.5.4"],
      }),
      // A repo without an installed version on record must not bring the 16.x fix back.
      row("next", "GHSA-major", "west"),
    ]);
    expect(out[0]).toMatchObject({ fixed: null, noLineFix: true });
  });

  it("falls back to the highest listed fix per line when installed versions are unknown", () => {
    const out = alertLinesOf([
      row("next", "GHSA-n1", "garden", { fixedVersion: "15.5.7, 16.0.7" }),
      row("next", "GHSA-n2", "garden", { fixedVersion: "15.5.9" }),
    ]);
    expect(out[0].fixed).toBe("16.0.7, 15.5.9");
    expect(alertLinesOf([row("x", "GHSA-x", "garden")])[0].fixed).toBeNull();
  });
});

describe("mergeFixedLists", () => {
  it("keeps the highest stable version per release line", () => {
    expect(mergeFixedLists(["4.7.9", "4.7.10", null])).toBe("4.7.10");
    expect(mergeFixedLists(["0.3.1, 0.4.2", "0.4.5", "1.0.0-rc.1"])).toBe("0.4.5, 0.3.1");
    expect(mergeFixedLists([null, ""])).toBeNull();
  });
});

describe("transitive alert lines", () => {
  it("labels transitive-only packages, drops their fix and lists them after direct ones", () => {
    const affected = [range("7.0.0", "7.29.1")];
    const out = alertLinesOf([
      {
        ...row("undici", "GHSA-u", "briff", {
          severity: "CRITICAL",
          affected,
          fixedVersion: "7.29.1",
          installed: ["7.20.0"],
        }),
        direct: false,
      },
      row("zod", "GHSA-z", "briff", { severity: "LOW" }),
    ]);
    expect(out.map((l) => [l.packageName, l.transitive, l.fixed])).toEqual([
      ["zod", false, null],
      ["undici", true, null],
    ]);
  });

  it("keeps a package direct (with its fix) when one repo has it directly", () => {
    const affected = [range("7.0.0", "7.29.1")];
    const out = alertLinesOf([
      { ...row("undici", "GHSA-u", "briff", { affected, installed: ["7.20.0"] }), direct: false },
      row("undici", "GHSA-u", "tracker", { affected, installed: ["7.21.0"] }),
    ]);
    expect(out[0]).toMatchObject({ transitive: false, fixed: "7.29.1" });
  });
});

describe("alert lines with several installed versions", () => {
  it("ignores a version already past the fix instead of voiding the fix", () => {
    const affected = [range("7.0.0", "7.29.1")];
    const out = alertLinesOf([
      row("undici", "GHSA-u", "orchid-hotel", { affected, installed: ["7.30.0", "7.24.4"] }),
      row("undici", "GHSA-u", "pixel-studio", { affected, installed: ["7.24.4"] }),
    ]);
    expect(out[0]).toMatchObject({ fixed: "7.29.1", noLineFix: false });
  });

  it("does not hide an affected version that has no fix behind another version's fix", () => {
    const affected = [
      range("7.0.0", "7.29.1"),
      { type: "SEMVER", events: [{ introduced: "8.0.0" }] },
    ];
    const out = alertLinesOf([
      row("undici", "GHSA-u", "pantheon", { affected, installed: ["7.20.0", "8.10.0"] }),
    ]);
    expect(out[0]).toMatchObject({ fixed: null, noLineFix: true });
  });

  it("shows no fix when every installed version is already past it", () => {
    const affected = [range("7.0.0", "7.29.1")];
    const out = alertLinesOf([
      row("undici", "GHSA-u", "briff", { affected, fixedVersion: "8.10.2", installed: ["7.30.0"] }),
    ]);
    expect(out[0]).toMatchObject({ fixed: null, noLineFix: false });
  });
});

describe("alert line installs", () => {
  it("gives each repo its installed version and the fix for its own line", () => {
    const out = alertLinesOf([
      row("next", "GHSA-n1", "sigma/forms-web", {
        affected: [range("15.0.0", "15.5.9"), range("16.0.0", "16.0.10")],
        installed: ["15.5.4"],
      }),
      row("next", "GHSA-n1", "sigma/tracker", {
        affected: [range("15.0.0", "15.5.9"), range("16.0.0", "16.0.10")],
        installed: ["16.0.3"],
      }),
    ]);
    expect(out[0].installs).toEqual([
      { repo: "sigma/forms-web", name: "next", installed: ["15.5.4"], target: "15.5.9" },
      { repo: "sigma/tracker", name: "next", installed: ["16.0.3"], target: "16.0.10" },
    ]);
  });

  it("names a repo without an installed version instead of hiding it", () => {
    const affected = [range("7.0.0", "7.29.1")];
    const out = alertLinesOf([
      row("undici", "GHSA-u", "briff", { affected, installed: ["7.20.0"] }),
      row("undici", "GHSA-u", "garden.example", { affected }),
    ]);
    expect(out[0].installs).toEqual([
      { repo: "briff", name: "undici", installed: ["7.20.0"], target: "7.29.1" },
      { repo: "garden.example", name: "undici", installed: [], target: null },
    ]);
  });

  it("leaves out a repo already past the fix and gives transitive lines no target", () => {
    const affected = [range("7.0.0", "7.29.1")];
    const out = alertLinesOf([
      { ...row("undici", "GHSA-u", "briff", { affected, installed: ["7.20.0"] }), direct: false },
      { ...row("undici", "GHSA-u", "mint", { affected, installed: ["7.30.0"] }), direct: false },
    ]);
    expect(out[0].installs).toEqual([
      { repo: "briff", name: "undici", installed: ["7.20.0"], target: null, transitive: true },
    ]);
  });
});
