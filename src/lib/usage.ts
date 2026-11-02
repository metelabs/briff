import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { isCloud } from "@/lib/env";
import { llmBudgetFor, monthStart, overBudget, utcDay } from "@/lib/llm-budget";
import { fromMicros, requestUsd, toMicros } from "@/llm/pricing";
import type { LlmTask, LlmUsage } from "@/llm/client";

// OrgUsage (one row per org and UTC day): written by the worker as each LLM request completes
// and by /api/scan per accepted upload; read by the monthly budget, Settings -> Billing and the
// instance admin's organisation table (loadOrgDirectory).

/** Makes sure the day's row exists; safe under concurrency (the unique key decides). */
async function ensureDay(db: PrismaClient, orgId: string, day: Date): Promise<void> {
  await withOrg(db, orgId).orgUsage.createMany({ data: [{ orgId, day }], skipDuplicates: true });
}

export interface LlmUsageRecord {
  task: LlmTask;
  model: string;
  usage: LlmUsage;
  /** Billed at the Message Batch rate. */
  batch: boolean;
  /** The request produced a bulletin (synthesis). */
  bulletin?: boolean;
}

/** Adds one completed request to the org's day. Unpriced models (the fake) add tokens only. */
export async function recordLlmUsage(
  db: PrismaClient,
  orgId: string,
  record: LlmUsageRecord,
  now: Date = new Date()
): Promise<void> {
  const day = utcDay(now);
  await ensureDay(db, orgId, day);
  const usd = requestUsd(record.model, record.usage, record.batch) ?? 0;
  await withOrg(db, orgId).orgUsage.updateMany({
    where: { day },
    data: {
      requests: { increment: 1 },
      bulletins: { increment: record.bulletin ? 1 : 0 },
      inputTokens: { increment: record.usage.inputTokens },
      outputTokens: { increment: record.usage.outputTokens },
      estimatedUsdMicros: { increment: toMicros(usd) },
    },
  });
}

export interface MonthUsage {
  requests: number;
  bulletins: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

export async function loadMonthUsage(
  db: PrismaClient,
  orgId: string,
  now: Date = new Date()
): Promise<MonthUsage> {
  const sum = await withOrg(db, orgId).orgUsage.aggregate({
    where: { day: { gte: monthStart(now) } },
    _sum: {
      requests: true,
      bulletins: true,
      inputTokens: true,
      outputTokens: true,
      estimatedUsdMicros: true,
    },
  });
  return {
    requests: sum._sum.requests ?? 0,
    bulletins: sum._sum.bulletins ?? 0,
    inputTokens: sum._sum.inputTokens ?? 0,
    outputTokens: sum._sum.outputTokens ?? 0,
    usd: fromMicros(sum._sum.estimatedUsdMicros ?? 0),
  };
}

export interface OrgBudget {
  /** null = no budget (self-hosted, Unlimited). */
  budgetUsd: number | null;
  spentUsd: number;
  economy: boolean;
}

export async function loadOrgBudget(
  db: PrismaClient,
  orgId: string,
  now: Date = new Date()
): Promise<OrgBudget> {
  const cloud = isCloud();
  const org = await db.org.findUniqueOrThrow({
    where: { id: orgId },
    select: { plan: true, llmBudgetUsd: true },
  });
  const budgetUsd = llmBudgetFor(org, { cloud });
  if (budgetUsd === null) return { budgetUsd, spentUsd: 0, economy: false };
  const { usd } = await loadMonthUsage(db, orgId, now);
  return { budgetUsd, spentUsd: usd, economy: overBudget(usd, budgetUsd) };
}

/**
 * Counts one scan upload against the org's daily limit. The conditional increment is atomic
 * (Postgres re-checks the WHERE under the row lock), so parallel uploads cannot pass the limit.
 */
export async function takeScanUpload(
  db: PrismaClient,
  orgId: string,
  limit: number | null,
  now: Date = new Date()
): Promise<boolean> {
  const day = utcDay(now);
  await ensureDay(db, orgId, day);
  const res = await withOrg(db, orgId).orgUsage.updateMany({
    where: { day, ...(limit === null ? {} : { scanUploads: { lt: limit } }) },
    data: { scanUploads: { increment: 1 } },
  });
  return res.count > 0;
}
