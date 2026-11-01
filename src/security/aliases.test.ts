import { describe, expect, it } from "vitest";

import { osvVulnSchema } from "@/sources/osv";

import { mixedHits, mixedQueries, mixedVuln } from "./__fixtures__/osv-mixed";
import { aliasGroups, coveredPackages, idRank, mergeAliasGroup } from "./aliases";

// Every recorded query, its hits grouped and merged as the scan stores them.
const merged = mixedQueries.flatMap((q) =>
  aliasGroups(mixedHits(q).map((h) => mixedVuln(h.id))).map((group) => ({
    query: q,
    group: group.map((v) => v.id).sort(),
    advisory: mergeAliasGroup(group, q.name, q.ecosystem),
  }))
);
const byId = (id: string) => merged.find((m) => m.advisory.osvId === id)?.advisory;

describe("aliasGroups / mergeAliasGroup on recorded OSV answers", () => {
  it("collapses each GHSA with its GO-* or PYSEC-* twin under the GHSA id", () => {
    const gin = merged.filter((m) => m.query.name === "github.com/gin-gonic/gin");
    expect(gin.map((m) => [m.advisory.osvId, m.group])).toEqual([
      ["GHSA-2c4m-59x9-fr2g", ["GHSA-2c4m-59x9-fr2g", "GO-2023-1737"]],
      ["GHSA-3vp4-m3rf-835h", ["GHSA-3vp4-m3rf-835h"]],
      ["GHSA-h395-qcrw-5vmq", ["GHSA-h395-qcrw-5vmq", "GO-2021-0052"]],
    ]);
    expect(byId("GHSA-2c4m-59x9-fr2g")).toMatchObject({
      aliases: ["CVE-2023-29401", "GO-2023-1737"],
      severity: "MODERATE",
      fixedVersion: "1.9.1",
    });
    expect(byId("GHSA-gmj6-6f8f-6699")).toMatchObject({
      aliases: ["CVE-2024-56201", "PYSEC-2026-1472"],
      fixedVersion: "3.1.5",
    });
    expect(byId("GHSA-j8r2-6x86-q33q")?.aliases).toEqual(["CVE-2023-32681", "PYSEC-2023-74"]);
  });

  it("leaves one advisory per vulnerability and no native id beside its GHSA", () => {
    const ids = merged.map((m) => m.advisory.osvId);
    expect(new Set(ids).size).toBe(ids.length);
    // 77 records, 31 of them a second entry for a vulnerability already listed.
    expect(merged).toHaveLength(46);
    expect(mixedQueries.flatMap((q) => mixedHits(q))).toHaveLength(77);
    for (const { advisory } of merged) {
      if (advisory.aliases.some((a) => a.startsWith("GHSA-"))) {
        expect(advisory.osvId).toMatch(/^GHSA-/);
      }
    }
  });

  it("merges two GHSA ids of one vulnerability and keeps both release lines' fixes", () => {
    const guzzle = byId("GHSA-f2wf-25xc-69c9");
    expect(guzzle?.aliases).toContain("GHSA-w248-ffj2-4v5q");
    expect(guzzle?.fixedVersion).toBe("6.5.7, 7.4.4");
    expect(byId("GHSA-w248-ffj2-4v5q")).toBeUndefined();
  });

  it("gives every advisory a level, except a Go-only record with none to inherit", () => {
    const unknown = merged.filter((m) => m.advisory.severity === null).map((m) => m.advisory.osvId);
    expect(unknown.sort()).toEqual(["GO-2026-5970", "GO-2026-6629"]);
    expect(byId("GO-2026-5970")?.aliases).toEqual(["CVE-2026-56852"]);
    for (const { advisory } of merged) {
      expect([null, "LOW", "MODERATE", "HIGH", "CRITICAL"]).toContain(advisory.severity);
    }
  });

  it("never names a commit hash as a fixed version", () => {
    for (const { advisory } of merged) {
      expect(advisory.fixedVersion ?? "").not.toMatch(/[0-9a-f]{40}/);
    }
    expect(byId("GHSA-248v-346w-9cwc")?.fixedVersion).toBe("2024.7.4");
  });
});

describe("mergeAliasGroup fallbacks", () => {
  const record = (id: string, extra: Record<string, unknown>) =>
    osvVulnSchema.parse({
      id,
      modified: "2026-10-01T00:00:00Z",
      affected: [
        {
          package: { ecosystem: "PyPI", name: "acme-http" },
          ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "2.0.0" }] }],
        },
      ],
      ...extra,
    });

  it("prefers the CVE record over a native one and inherits what it lacks", () => {
    const out = mergeAliasGroup(
      [
        record("PYSEC-2026-9", {
          aliases: ["CVE-2026-0001"],
          summary: "Header injection",
          modified: "2026-10-05T00:00:00Z",
          severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }],
        }),
        record("CVE-2026-0001", { aliases: ["PYSEC-2026-9"] }),
      ],
      "acme-http",
      "PyPI"
    );
    expect(out).toMatchObject({
      osvId: "CVE-2026-0001",
      aliases: ["PYSEC-2026-9"],
      summary: "Header injection",
      severity: "CRITICAL",
      fixedVersion: "2.0.0",
    });
    expect(out.modifiedAt?.toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });

  it("joins records through a shared CVE even when neither names the other", () => {
    const groups = aliasGroups([
      record("GO-2026-1", { aliases: ["CVE-2026-0002"] }),
      record("GHSA-aaaa-bbbb-cccc", { aliases: ["CVE-2026-0002"] }),
      record("GO-2026-2", {}),
    ]);
    expect(groups.map((g) => g.map((v) => v.id))).toEqual([
      ["GO-2026-1", "GHSA-aaaa-bbbb-cccc"],
      ["GO-2026-2"],
    ]);
  });

  it("ranks GHSA before CVE before native ids", () => {
    expect([idRank("GHSA-x"), idRank("CVE-x"), idRank("PYSEC-x"), idRank("GO-x")]).toEqual([
      0, 1, 2, 2,
    ]);
  });
});

describe("coveredPackages", () => {
  it("lists every package of the merged records once, names normalised like Package rows", () => {
    const record = (pkgs: [string, string][]) =>
      ({
        affected: pkgs.map(([ecosystem, name]) => ({ package: { ecosystem, name }, ranges: [] })),
      }) as unknown as Parameters<typeof coveredPackages>[0][number];
    expect(
      coveredPackages([
        record([
          ["npm", "payload"],
          ["npm", "@payloadcms/db-postgres"],
        ]),
        record([
          ["PyPI", "Flask_SQLAlchemy"],
          ["npm", "payload"],
          ["Debian:12", "openssl"],
        ]),
      ])
    ).toEqual([
      { ecosystem: "npm", name: "payload" },
      { ecosystem: "npm", name: "@payloadcms/db-postgres" },
      { ecosystem: "PyPI", name: "flask-sqlalchemy" },
    ]);
  });
});
