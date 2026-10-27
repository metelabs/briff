import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { mixedVuln } from "@/security/__fixtures__/osv-mixed";

import {
  affectedInstalls,
  comparableRange,
  fixedVersionFor,
  isAffected,
  osvQueryOf,
  osvVulnSchema,
  severityOf,
  toAdvisoryFields,
} from "./osv";

const vuln = osvVulnSchema.parse(
  JSON.parse(readFileSync(path.join(__dirname, "__fixtures__", "osv-vuln.json"), "utf8"))
);

describe("toAdvisoryFields", () => {
  it("projects the record onto one package", () => {
    const fields = toAdvisoryFields(vuln, "next");
    expect(fields.osvId).toBe("GHSA-9qr9-h5gf-34mp");
    expect(fields.severity).toBe("CRITICAL");
    expect(fields.affected).toHaveLength(3);
    expect(fields.fixedVersion).toBe("15.0.5, 15.1.9, 15.2.6");
    expect(fields.url).toMatch(/^https:\/\//);
    expect(fields.publishedAt?.toISOString()).toBe("2025-12-03T19:07:11.000Z");
  });

  it("ignores ranges of other packages in the same record", () => {
    expect(toAdvisoryFields(vuln, "other-pkg").fixedVersion).toBe("9.9.9");
    expect(toAdvisoryFields(vuln, "unrelated").affected).toEqual([]);
  });
});

describe("fixedVersionFor", () => {
  const ranges = toAdvisoryFields(vuln, "next").affected;

  it("finds the fix for the branch the installed version is on", () => {
    expect(fixedVersionFor(ranges, "15.1.3")).toBe("15.1.9");
    expect(fixedVersionFor(ranges, "15.0.0")).toBe("15.0.5");
  });

  it("returns null for patched or unaffected versions", () => {
    expect(fixedVersionFor(ranges, "15.1.9")).toBeNull();
    expect(fixedVersionFor(ranges, "13.0.0")).toBeNull();
    expect(fixedVersionFor(ranges, "not-a-version")).toBeNull();
  });
});

describe("isAffected", () => {
  const ranges = [
    { type: "SEMVER", events: [{ introduced: "0" }, { fixed: "7.29.1" }] },
    { type: "SEMVER", events: [{ introduced: "8.0.0" }, { last_affected: "8.10.1" }] },
    { type: "SEMVER", events: [{ introduced: "9.0.0" }] },
  ];

  it("checks fixed (exclusive), last_affected (inclusive) and open-ended ranges", () => {
    expect(isAffected(ranges, "7.20.0")).toBe(true);
    expect(isAffected(ranges, "7.29.1")).toBe(false);
    expect(isAffected(ranges, "7.30.0")).toBe(false);
    expect(isAffected(ranges, "8.10.1")).toBe(true);
    expect(isAffected(ranges, "8.10.2")).toBe(false);
    expect(isAffected(ranges, "9.3.0")).toBe(true);
    expect(isAffected(ranges, "workspace:*")).toBe(false);
  });
});

describe("isAffected with a limit event", () => {
  // OSV `limit` ends a range exclusively, like `fixed`, without naming a fix.
  const vuln = osvVulnSchema.parse({
    id: "GHSA-limit",
    modified: "2026-10-20T00:00:00Z",
    affected: [
      {
        package: { ecosystem: "npm", name: "undici" },
        ranges: [
          { type: "SEMVER", events: [{ introduced: "6.0.0" }, { limit: "7.0.0" }] },
          { type: "SEMVER", events: [{ introduced: "8.0.0" }, { limit: "*" }] },
        ],
      },
    ],
  });
  const ranges = toAdvisoryFields(vuln, "undici").affected;

  it("treats limit as an exclusive upper bound and * as unbounded", () => {
    expect(isAffected(ranges, "6.5.0")).toBe(true);
    expect(isAffected(ranges, "7.0.0")).toBe(false);
    expect(isAffected(ranges, "7.29.0")).toBe(false);
    expect(isAffected(ranges, "8.12.0")).toBe(true);
    expect(fixedVersionFor(ranges, "6.5.0")).toBeNull();
  });
});

describe("affectedInstalls", () => {
  it("keeps affected installs and every install when there is no SEMVER range", () => {
    const ranges = [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "7.29.1" }] }];
    expect(affectedInstalls(ranges, ["7.20.0", "7.30.0"], (v) => v)).toEqual(["7.20.0"]);
    expect(affectedInstalls([], ["7.20.0", "7.30.0"], (v) => v)).toEqual(["7.20.0", "7.30.0"]);
  });
});

describe("OSV queries per ecosystem", () => {
  it("sends each package's own ecosystem, npm when none is given", () => {
    expect(osvQueryOf({ name: "next", version: "16.4.1" })).toEqual({
      package: { ecosystem: "npm", name: "next" },
      version: "16.4.1",
    });
    expect(osvQueryOf({ name: "acme/log", version: "3.0.2", ecosystem: "Packagist" })).toEqual({
      package: { ecosystem: "Packagist", name: "acme/log" },
      version: "3.0.2",
    });
  });
});

describe("toAdvisoryFields for Packagist", () => {
  const record = osvVulnSchema.parse(
    JSON.parse(
      readFileSync(path.join(__dirname, "__fixtures__", "osv-vuln-packagist.json"), "utf8")
    )
  );
  const fields = toAdvisoryFields(record, "acme/http-kernel", "Packagist");

  it("keeps only the Packagist package's ranges, as SEMVER ranges with Composer versions normalised", () => {
    expect(fields.affected.map((r) => r.type)).toEqual(["SEMVER", "SEMVER", "SEMVER"]);
    expect(fields.fixedVersion).toBe("5.4.46, 6.4.4, 7.1.2");
    expect(fields.severity).toBe("HIGH");
  });

  it("resolves the fix on the installed line, like npm", () => {
    expect(isAffected(fields.affected, "6.4.3")).toBe(true);
    expect(fixedVersionFor(fields.affected, "6.4.3")).toBe("6.4.4");
    expect(fixedVersionFor(fields.affected, "7.0.0")).toBe("7.1.2");
    expect(isAffected(fields.affected, "6.4.4")).toBe(false);
  });

  it("matches Composer names case-insensitively and never another ecosystem's ranges", () => {
    expect(toAdvisoryFields(record, "Acme/HTTP-Kernel", "Packagist").fixedVersion).toBe(
      "5.4.46, 6.4.4, 7.1.2"
    );
    expect(toAdvisoryFields(record, "acme/http-kernel").fixedVersion).toBe("9.9.9");
  });

  it("counts an installed version without a semver form as affected, with no fix", () => {
    const ranges = [{ type: "SEMVER", events: [{ introduced: "2.0.0" }, { fixed: "2.0.1" }] }];
    expect(affectedInstalls(ranges, ["2.0.0.1", "2.0.1", "1.9.0"], (v) => v)).toEqual(["2.0.0.1"]);
    expect(fixedVersionFor(ranges, "2.0.0.1")).toBeNull();
  });

  it("converts all ranges or none, so an unconvertible one still counts every install", () => {
    const mixed = osvVulnSchema.parse({
      id: "GHSA-acme-mixed",
      modified: "2026-10-20T00:00:00Z",
      affected: [
        {
          package: { ecosystem: "Packagist", name: "acme/odd" },
          ranges: [
            { type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "1.9.0" }] },
            { type: "ECOSYSTEM", events: [{ introduced: "2.0.0" }, { fixed: "2.0.0.1" }] },
          ],
        },
      ],
    });
    const fields = toAdvisoryFields(mixed, "acme/odd", "Packagist");
    expect(fields.affected.map((r) => r.type)).toEqual(["ECOSYSTEM", "ECOSYSTEM"]);
    // 2.0.0 is in the unconverted range: it must not be ruled out.
    expect(affectedInstalls(fields.affected, ["2.0.0", "1.0.0"], (v) => v)).toEqual([
      "2.0.0",
      "1.0.0",
    ]);
    expect(fixedVersionFor(fields.affected, "2.0.0")).toBeNull();
  });

  it("keeps a range it cannot read as semver, which then rules nothing out", () => {
    const odd = { type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "2.0.0.1" }] };
    expect(comparableRange(odd, "Packagist")).toEqual(odd);
    expect(affectedInstalls([odd], ["1.0.0", "3.0.0"], (v) => v)).toEqual(["1.0.0", "3.0.0"]);
  });
});

describe("toAdvisoryFields for PyPI", () => {
  const record = osvVulnSchema.parse(
    JSON.parse(readFileSync(path.join(__dirname, "__fixtures__", "osv-vuln-pypi.json"), "utf8"))
  );

  it("matches PEP 503 names and reads PEP 440 versions as semver", () => {
    const fields = toAdvisoryFields(record, "acme-http", "PyPI");
    expect(fields.affected).toEqual([
      { type: "SEMVER", events: [{ introduced: "2.3.0" }, { fixed: "2.32.0" }] },
      { type: "SEMVER", events: [{ introduced: "3.0.0-rc.1" }, { fixed: "3.0.1" }] },
    ]);
    expect(fixedVersionFor(fields.affected, "2.31.0")).toBe("2.32.0");
    expect(isAffected(fields.affected, "3.0.0-rc.2")).toBe(true);
    expect(isAffected(fields.affected, "2.2.0")).toBe(false);
  });

  it("sends the stored name in the PyPI ecosystem", () => {
    expect(osvQueryOf({ name: "acme-http", version: "2.31.0", ecosystem: "PyPI" })).toEqual({
      package: { ecosystem: "PyPI", name: "acme-http" },
      version: "2.31.0",
    });
  });
});

describe("toAdvisoryFields for Go", () => {
  const record = osvVulnSchema.parse(
    JSON.parse(readFileSync(path.join(__dirname, "__fixtures__", "osv-vuln-go.json"), "utf8"))
  );

  it("reads the module's SEMVER ranges as they are, versions without the v", () => {
    const fields = toAdvisoryFields(record, "golang.org/x/net", "Go");
    expect(fields.fixedVersion).toBe("0.33.0");
    expect(fixedVersionFor(fields.affected, "0.30.0")).toBe("0.33.0");
    expect(toAdvisoryFields(record, "golang.org/x/text", "Go").affected).toEqual([]);
  });

  it("queries the module path in the Go ecosystem", () => {
    expect(osvQueryOf({ name: "golang.org/x/net", version: "0.30.0", ecosystem: "Go" })).toEqual({
      package: { ecosystem: "Go", name: "golang.org/x/net" },
      version: "0.30.0",
    });
  });
});

describe("toAdvisoryFields on recorded PyPI and Go records", () => {
  it("takes fixed versions from release ranges only, never a GIT range's commit", () => {
    // PYSEC records carry a GIT range (commit hashes) next to the ECOSYSTEM one.
    expect(toAdvisoryFields(mixedVuln("PYSEC-2024-230"), "certifi", "PyPI")).toMatchObject({
      fixedVersion: "2024.7.4",
      affected: [{ type: "SEMVER", events: [{ introduced: "2021.5.30" }, { fixed: "2024.7.4" }] }],
    });
    expect(toAdvisoryFields(mixedVuln("PYSEC-2023-74"), "requests", "PyPI").fixedVersion).toBe(
      "2.31.0"
    );
    expect(toAdvisoryFields(mixedVuln("PYSEC-2023-192"), "urllib3", "PyPI").fixedVersion).toBe(
      "2.0.6, 1.26.17"
    );
  });

  it("stores a level: GitHub's label, else the CVSS vector's score, else none", () => {
    // GHSA: database_specific.severity.
    expect(severityOf(mixedVuln("GHSA-f2wf-25xc-69c9"))).toBe("HIGH");
    // PYSEC: only CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:N (7.5).
    expect(toAdvisoryFields(mixedVuln("PYSEC-2024-230"), "certifi", "PyPI").severity).toBe("HIGH");
    // PYSEC with v3 (8.8) and v4 (5.4): the v4 score, as GitHub rates it.
    expect(severityOf(mixedVuln("PYSEC-2026-1472"))).toBe("MODERATE");
    // GO-*: no severity at all.
    expect(severityOf(mixedVuln("GO-2023-1737"))).toBeNull();
  });
});

it("queries RubyGems by its OSV ecosystem name", () => {
  expect(osvQueryOf({ name: "rack", version: "2.2.3", ecosystem: "RubyGems" })).toEqual({
    package: { name: "rack", ecosystem: "RubyGems" },
    version: "2.2.3",
  });
});

it("queries crates.io by its OSV ecosystem name", () => {
  expect(osvQueryOf({ name: "tokio", version: "1.24.1", ecosystem: "crates.io" })).toEqual({
    package: { name: "tokio", ecosystem: "crates.io" },
    version: "1.24.1",
  });
});

it("queries Maven coordinates with the OSV ecosystem name", () => {
  expect(osvQueryOf({ name: "org.acme:kit", version: "1.2.3", ecosystem: "Maven" })).toEqual({
    package: { name: "org.acme:kit", ecosystem: "Maven" },
    version: "1.2.3",
  });
});
