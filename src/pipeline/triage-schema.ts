import { z } from "zod";

import { BUCKETS, type Bucket } from "./buckets";

// Structured output contract for triage. The JSON schema goes to the API; the
// zod schema validates what comes back (the API guarantees shape, not meaning).

export const TRIAGE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["results"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "bucket", "reason", "packages", "deadline"],
        properties: {
          ref: { type: "integer" },
          bucket: { type: "string", enum: [...BUCKETS] },
          reason: { type: "string" },
          packages: { type: "array", items: { type: "string" } },
          deadline: {
            anyOf: [
              { type: "null" },
              {
                type: "object",
                additionalProperties: false,
                required: ["due_date", "what"],
                properties: { due_date: { type: "string" }, what: { type: "string" } },
              },
            ],
          },
        },
      },
    },
  },
} as const;

export const triageOutputSchema = z.object({
  results: z.array(
    z.object({
      ref: z.number().int(),
      bucket: z.enum(BUCKETS),
      reason: z.string(),
      packages: z.array(z.string()),
      deadline: z.object({ due_date: z.string(), what: z.string() }).nullable(),
    })
  ),
});

export type TriageOutput = z.infer<typeof triageOutputSchema>;

export interface TriageDecision {
  ref: number;
  bucket: Bucket;
  reason: string;
  packages: string[];
  dueAt: Date | null;
  dueWhat: string | null;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` to a UTC date; rejects impossible dates like 2026-02-31. */
export function parseDueDate(value: string): Date | null {
  const m = DATE.exec(value.trim());
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return date.getUTCMonth() === Number(m[2]) - 1 && date.getUTCDate() === Number(m[3])
    ? date
    : null;
}

/**
 * Keeps one decision per requested ref. Unknown refs are ignored, duplicates keep
 * the first; a `deadline` without a valid date is demoted to breaking_or_feature
 * (the date is the point of the bucket, and a wrong date breaks trust).
 */
export function interpretTriage(refs: readonly number[], output: TriageOutput): TriageDecision[] {
  const wanted = new Set(refs);
  const seen = new Set<number>();
  const decisions: TriageDecision[] = [];
  for (const r of output.results) {
    if (!wanted.has(r.ref) || seen.has(r.ref)) continue;
    seen.add(r.ref);
    const dueAt = r.deadline ? parseDueDate(r.deadline.due_date) : null;
    const isDeadline = r.bucket === "deadline" && dueAt !== null;
    decisions.push({
      ref: r.ref,
      bucket: r.bucket === "deadline" && !isDeadline ? "breaking_or_feature" : r.bucket,
      reason: r.reason.slice(0, 300),
      packages: [...new Set(r.packages.map((p) => p.trim()).filter(Boolean))].slice(0, 20),
      dueAt: isDeadline ? dueAt : null,
      dueWhat: isDeadline ? (r.deadline?.what.slice(0, 500) ?? null) : null,
    });
  }
  return decisions;
}
