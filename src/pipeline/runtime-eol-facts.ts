import { endOfLifeDate } from "@/lib/runtime-eol";
import { releaseLineOf } from "@/lib/runtime-security";
import { isConstraintRow, runtimeEvidence } from "@scan/runtimes";

interface RuntimeEvidence {
  repo: string;
  name: string;
  version: string;
  normalized: string | null;
  source: string;
  unresolved: boolean;
  constraint?: boolean | null;
}

export function upcomingEol(
  rows: readonly RuntimeEvidence[],
  now: Date
): { facts: string[]; identities: string[] } {
  const grouped = new Map<string, RuntimeEvidence[]>();
  for (const row of rows) {
    const key = `${row.repo}\0${row.name}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  const facts = new Map<string, string>();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (const evidence of grouped.values()) {
    for (const row of runtimeEvidence(evidence)) {
      if (row.unresolved || isConstraintRow(row)) continue;
      const line = releaseLineOf(row.name, row.normalized ?? row.version);
      const date = line ? endOfLifeDate(row.name, line) : null;
      if (!date) continue;
      const days = Math.round((Date.parse(`${date}T00:00:00Z`) - today) / 86_400_000);
      if (days >= 0 && days <= 90)
        facts.set(
          JSON.stringify([row.repo, row.name, line, date]),
          `${row.repo}: ${row.name} ${line} — EOL in ${days} days (EOL on ${date}).`
        );
    }
  }
  return { facts: [...facts.values()].sort(), identities: [...facts.keys()].sort() };
}

export function upcomingEolFacts(rows: readonly RuntimeEvidence[], now: Date): string[] {
  return upcomingEol(rows, now).facts;
}
