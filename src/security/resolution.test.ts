import { describe, expect, it } from "vitest";

import {
  planAlertResolution,
  stillAffected,
  type InstalledDependency,
  type ResolvableAlert,
} from "./resolution";

// lodash < 4.17.21 is affected.
const RANGES = [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "4.17.21" }] }];

const alert = (over: Partial<ResolvableAlert> = {}): ResolvableAlert => ({
  id: "a1",
  resolvedAt: null,
  packageId: "p-lodash",
  ecosystem: "npm",
  packageName: "lodash",
  affected: RANGES,
  covered: [{ ecosystem: "npm", name: "lodash" }],
  ...over,
});
const dep = (over: Partial<InstalledDependency> = {}): InstalledDependency => ({
  packageId: "p-lodash",
  ecosystem: "npm",
  name: "lodash",
  version: "4.17.20",
  unresolved: false,
  constraint: false,
  ...over,
});
const other = dep({ packageId: "p-other", name: "other", version: "1.0.0" });
const before = new Set(["p-lodash"]);

describe("stillAffected", () => {
  it("is true while an installed version is in the range", () => {
    expect(stillAffected(alert(), [dep()])).toBe(true);
    expect(stillAffected(alert(), [dep({ version: "4.17.21" })])).toBe(false);
  });

  it("keeps versions it cannot place affected", () => {
    expect(stillAffected(alert(), [dep({ version: "^4.17.0", unresolved: true })])).toBe(true);
    expect(stillAffected(alert(), [dep({ version: "v4", constraint: true })])).toBe(true);
    expect(stillAffected(alert({ affected: [] }), [dep({ version: "4.17.21" })])).toBe(true);
  });

  it("is false when the package is gone", () => {
    expect(stillAffected(alert(), [other])).toBe(false);
  });
});

describe("planAlertResolution", () => {
  it("resolves an open alert when the upload has the fixed version or no longer the package", () => {
    expect(planAlertResolution([alert()], before, [dep({ version: "4.17.21" })])).toEqual({
      resolve: ["a1"],
      reopen: [],
    });
    expect(planAlertResolution([alert()], before, [other])).toEqual({
      resolve: ["a1"],
      reopen: [],
    });
  });

  it("keeps an alert open while any installed version is affected", () => {
    const installed = [dep({ version: "4.17.21" }), dep({ version: "4.17.15" })];
    expect(planAlertResolution([alert()], before, installed)).toEqual({ resolve: [], reopen: [] });
  });

  it("does not resolve from an upload without the package's ecosystem (a lockfile failed to parse)", () => {
    expect(planAlertResolution([alert()], before, [])).toEqual({ resolve: [], reopen: [] });
    const composerOnly = [dep({ packageId: "p-x", ecosystem: "Packagist", version: "1.0.0" })];
    expect(planAlertResolution([alert()], before, composerOnly)).toEqual({
      resolve: [],
      reopen: [],
    });
  });

  it("does not resolve an alert whose package the repo did not have before", () => {
    // Another package of the same OSV record raised it; this upload cannot judge it.
    expect(planAlertResolution([alert()], new Set(), [other])).toEqual({ resolve: [], reopen: [] });
  });

  it("leaves an alert open while another package of the same OSV record is installed", () => {
    // payload's advisory also covers its db driver; only the stored package's ranges are known.
    const covered = [
      { ecosystem: "npm", name: "lodash" },
      { ecosystem: "npm", name: "lodash-driver" },
    ];
    const driver = dep({ packageId: "p-driver", name: "lodash-driver", version: "1.0.0" });
    const fixed = dep({ version: "4.17.21" });
    expect(planAlertResolution([alert({ covered })], before, [fixed, driver]).resolve).toEqual([]);
    expect(planAlertResolution([alert({ covered })], before, [fixed]).resolve).toEqual(["a1"]);
  });

  it("does not resolve while the advisory's packages are not known yet", () => {
    const fixed = [dep({ version: "4.17.21" })];
    expect(planAlertResolution([alert({ covered: null })], before, fixed).resolve).toEqual([]);
  });

  it("reopens a resolved alert when an affected version comes back, and leaves it otherwise", () => {
    const resolved = alert({ resolvedAt: new Date("2026-10-30T10:00:00Z") });
    expect(planAlertResolution([resolved], new Set(), [dep()])).toEqual({
      resolve: [],
      reopen: ["a1"],
    });
    expect(planAlertResolution([resolved], before, [dep({ version: "4.17.21" })])).toEqual({
      resolve: [],
      reopen: [],
    });
  });
});
