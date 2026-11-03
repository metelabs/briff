import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { monthStart, previousMonthStart } from "@/lib/llm-budget";
import { sumEstimates, type UsdEstimate } from "@/llm/pricing";

/** The job types whose runs carry LLM tokens (profile refresh runs inside weekly-bulletin). */
export const LLM_JOB_TYPES = ["triage-items", "weekly-bulletin"] as const;

export interface LlmCost {
  thisMonth: UsdEstimate;
  lastMonth: UsdEstimate;
}

/** Admin's "LLM cost" card: every run's tokens this and last calendar month (UTC), priced. */
export async function loadLlmCost(db: PrismaClient, now: Date = new Date()): Promise<LlmCost> {
  const start = monthStart(now);
  const runs = await db.run.findMany({
    where: { jobType: { in: [...LLM_JOB_TYPES] }, startedAt: { gte: previousMonthStart(now) } },
    select: { startedAt: true, tokens: true },
  });
  return {
    thisMonth: sumEstimates(runs.filter((r) => r.startedAt >= start).map((r) => r.tokens)),
    lastMonth: sumEstimates(runs.filter((r) => r.startedAt < start).map((r) => r.tokens)),
  };
}
