import { describe, expect, it } from "vitest";

import {
  groupIncidents,
  incidentPrimary,
  incidentSourceOrder,
  mergeIncidentMeta,
  sameIncident,
  type IncidentFacts,
} from "./runtime-incident";
import type { RuntimeItemMeta } from "./runtime-security";

const meta = (over: Partial<RuntimeItemMeta>): RuntimeItemMeta => ({
  kind: "announcement",
  cveIds: [],
  severity: "critical",
  fixedVersions: [],
  ...over,
});

const item = (
  id: string,
  over: Partial<RuntimeItemMeta>,
  publishedAt = "2026-10-21T13:40:00Z",
  runtime = "php"
): IncidentFacts & { id: string } => ({
  id,
  runtime,
  meta: meta(over),
  publishedAt: new Date(publishedAt),
  contentHash: `hash-${id}`,
});

const CVES = ["CVE-2026-109618", "CVE-2026-109619"];
const ALL_FIXES = ["8.5.12", "8.4.27", "8.3.36", "8.2.35"];
const advisoryPost = item("post", { cveIds: CVES, fixedVersions: ALL_FIXES });
const php83 = item("8.3", { cveIds: CVES, fixedVersions: ["8.3.36"], lineSpecific: true });
const php84 = item("8.4", { cveIds: CVES, fixedVersions: ["8.4.27"], lineSpecific: true });
const ghsaA = item(
  "ghsa-w8hw",
  { kind: "advisory", ghsaId: "GHSA-w8hw-w9fx-j79w", cveIds: [CVES[0]], fixedVersions: ALL_FIXES },
  "2026-10-21T13:34:25Z"
);
const ghsaB = item(
  "ghsa-6wmf",
  { kind: "advisory", ghsaId: "GHSA-6wmf-4rv5-p3rp", cveIds: [CVES[1]], fixedVersions: ALL_FIXES },
  "2026-10-21T13:34:13Z"
);
const facts = (i: IncidentFacts) => i;

describe("sameIncident", () => {
  it("links items of one runtime by a shared CVE id", () => {
    expect(sameIncident(advisoryPost, ghsaA)).toBe(true);
    expect(sameIncident(php83, php84)).toBe(true);
    expect(sameIncident(advisoryPost, { ...ghsaA, runtime: "node" })).toBe(false);
  });

  it("links a release post without CVE ids by an overlapping fixed version", () => {
    const bare = item("bare", { fixedVersions: ["8.3.36"], lineSpecific: true });
    expect(sameIncident(bare, advisoryPost)).toBe(true);
    expect(sameIncident(item("other", { fixedVersions: ["8.3.35"] }), advisoryPost)).toBe(false);
  });

  it("keeps advisories with disjoint CVE ids apart, and items more than 72h apart", () => {
    expect(sameIncident(ghsaA, ghsaB)).toBe(false);
    const late = item("late", { cveIds: CVES, fixedVersions: ALL_FIXES }, "2026-10-24T13:41:00Z");
    expect(sameIncident(advisoryPost, late)).toBe(false);
  });
});

describe("groupIncidents", () => {
  it("joins advisories through the posts that carry both CVEs, ordered by start", () => {
    const unrelated = item(
      "sept",
      { kind: "advisory", ghsaId: "GHSA-7875-c8px-7q5f", cveIds: ["CVE-2026-93682"] },
      "2026-10-21T12:00:00Z"
    );
    const groups = groupIncidents([php84, ghsaA, unrelated, advisoryPost, ghsaB, php83], facts);
    expect(groups.map((g) => g.map((i) => i.id))).toEqual([
      ["sept"],
      ["8.4", "ghsa-w8hw", "post", "ghsa-6wmf", "8.3"],
    ]);
    expect(groupIncidents([ghsaA, ghsaB], facts)).toHaveLength(2);
  });
});

describe("incidentPrimary", () => {
  it("heads with the vendor advisory post, then a GitHub advisory, then a release post", () => {
    const group = [php83, ghsaA, advisoryPost, ghsaB, php84];
    expect(incidentPrimary(group, facts).id).toBe("post");
    expect(incidentPrimary([php83, ghsaA, ghsaB], facts).id).toBe("ghsa-6wmf");
    expect(incidentPrimary([php84, php83], facts).id).toBe("8.3");
  });

  it("prefers the announcement that went from notice to fix", () => {
    const rewritten = item("node-post", {
      cveIds: CVES,
      fixedVersions: ALL_FIXES,
      fixAddedAt: "2026-10-21T13:00:00.000Z",
    });
    const notice = item("notice", { scheduledAt: "2026-10-21T14:00:00.000Z" });
    expect(incidentPrimary([advisoryPost, rewritten], facts).id).toBe("node-post");
    // A notice without fixed versions never heads a group that has them.
    expect(incidentPrimary([notice, php83], facts).id).toBe("8.3");
  });

  it("lists sources primary first, then posts by date, then advisories by GHSA id", () => {
    const order = incidentSourceOrder([ghsaA, php84, ghsaB, advisoryPost, php83], facts);
    expect(order.map((i) => i.id)).toEqual(["post", "8.3", "8.4", "ghsa-6wmf", "ghsa-w8hw"]);
  });
});

describe("mergeIncidentMeta", () => {
  it("merges CVEs, fixed versions per line and the highest severity", () => {
    const merged = mergeIncidentMeta("php", ghsaA.meta, [
      ghsaA.meta,
      { ...ghsaB.meta, severity: "high" },
      php83.meta,
    ]);
    expect(merged).toMatchObject({
      kind: "advisory",
      ghsaId: "GHSA-w8hw-w9fx-j79w",
      cveIds: CVES,
      severity: "critical",
      fixedVersions: ALL_FIXES,
    });
    expect(merged.lineSpecific).toBeUndefined();
    expect(merged.affectedLines).toBeUndefined();
  });

  it("turns single-line posts into the lines the incident lists", () => {
    const merged = mergeIncidentMeta("php", php83.meta, [php83.meta, php84.meta]);
    expect(merged.fixedVersions).toEqual(["8.4.27", "8.3.36"]);
    expect(merged.affectedLines).toEqual(["8.4", "8.3"]);
    expect(merged.lineSpecific).toBeUndefined();
  });

  it("ranks an unknown severity with high, never below an explicit low", () => {
    const unknown = { ...php83.meta, severity: null };
    expect(
      mergeIncidentMeta("php", unknown, [unknown, { ...ghsaA.meta, severity: "low" }]).severity
    ).toBeNull();
    expect(
      mergeIncidentMeta("php", unknown, [unknown, { ...ghsaA.meta, severity: "high" }]).severity
    ).toBe("high");
  });

  it("returns a lone item's facts unchanged", () => {
    expect(mergeIncidentMeta("php", php83.meta, [php83.meta])).toBe(php83.meta);
  });
});
