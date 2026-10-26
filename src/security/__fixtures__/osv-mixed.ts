import { readFileSync } from "node:fs";
import path from "node:path";

import { osvVulnSchema, type OsvHit, type OsvQuery, type OsvVuln } from "@/sources/osv";
import type { Ecosystem } from "@scan/ecosystems";

// Recorded OSV answers for one Composer, PyPI and Go stack (osv-mixed-ecosystems.json).

interface Recorded {
  queries: { package: { ecosystem: Ecosystem; name: string }; version: string }[];
  results: { vulns: { id: string; modified: string }[] }[];
  vulns: Record<string, unknown>;
}

const recorded = JSON.parse(
  readFileSync(path.join(__dirname, "osv-mixed-ecosystems.json"), "utf8")
) as Recorded;

export const mixedQueries: Required<Omit<OsvQuery, "constraint">>[] = recorded.queries.map((q) => ({
  ecosystem: q.package.ecosystem,
  name: q.package.name,
  version: q.version,
}));

/** The querybatch answer for one query; empty for a package the recording does not hold. */
export function mixedHits(q: OsvQuery): OsvHit[] {
  const i = mixedQueries.findIndex(
    (r) => r.ecosystem === (q.ecosystem ?? "npm") && r.name === q.name && r.version === q.version
  );
  return i < 0 ? [] : recorded.results[i].vulns.map((v) => ({ id: v.id, modified: v.modified }));
}

export function mixedVuln(id: string): OsvVuln {
  const raw = recorded.vulns[id];
  if (!raw) throw new Error(`no recorded OSV record ${id}`);
  return osvVulnSchema.parse(raw);
}

export const mixedVulnIds = Object.keys(recorded.vulns);
