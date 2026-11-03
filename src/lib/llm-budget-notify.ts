import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { isCloud } from "@/lib/env";
import { llmBudgetFor, monthKey, monthStart, reachedThreshold } from "@/lib/llm-budget";
import type { Logger } from "@/lib/log";
import { sendOpsAlert } from "@/lib/ops/alerts";
import { PLANS } from "@/lib/plans";
import { loadMonthUsage } from "@/lib/usage";

export type BudgetNotice = "none" | "80" | "100";

/**
 * Tells the org's owners (billing-notify email) and the operator (OpsAlert) once per month and
 * threshold that the org reached 80 % or 100 % of its LLM budget. The claim on the org row is
 * atomic: whichever caller moves `llmBudgetNotifiedPct` up queues the emails, in the same
 * transaction, so a retry or a second worker never sends them twice. Reaching 100 % straight
 * away skips the 80 % email.
 */
export async function notifyBudgetThreshold(
  db: PrismaClient,
  orgId: string,
  log: Logger,
  now: Date = new Date(),
  heartbeat: () => Promise<void> = async () => {}
): Promise<BudgetNotice> {
  const org = await db.org.findUnique({
    where: { id: orgId },
    select: { name: true, plan: true, llmBudgetUsd: true },
  });
  if (!org) return "none";
  const budgetUsd = llmBudgetFor(org, { cloud: isCloud() });
  if (budgetUsd === null) return "none";
  const { usd: spentUsd } = await loadMonthUsage(db, orgId, now);
  const threshold = reachedThreshold(spentUsd, budgetUsd);
  if (threshold === 0) return "none";

  const month = monthStart(now);
  const key = `${monthKey(now)}:${threshold}`;
  const claimed = await withOrg(db, orgId).$transaction(async (tx) => {
    const claim = await tx.org.updateMany({
      where: {
        id: orgId,
        OR: [
          { llmBudgetNotifiedMonth: null },
          { llmBudgetNotifiedMonth: { not: month } },
          { llmBudgetNotifiedPct: { lt: threshold } },
        ],
      },
      data: { llmBudgetNotifiedMonth: month, llmBudgetNotifiedPct: threshold },
    });
    if (claim.count === 0) return false;
    const owners = await tx.orgMember.findMany({
      where: { role: "owner" },
      orderBy: { createdAt: "asc" },
      select: { userId: true },
    });
    for (const { userId } of owners) {
      await tx.job.create({
        data: {
          type: "billing-notify",
          dedupeKey: `billing-notify:llm-budget:${orgId}:${key}:${userId}`,
          payload: { orgId, userId, kind: "llm-budget", threshold, spentUsd, budgetUsd },
        },
      });
    }
    return true;
  });
  if (!claimed) return "none";

  log.warn({ orgId, threshold, spentUsd, budgetUsd }, "llm budget: threshold reached");
  try {
    await sendOpsAlert(
      db,
      {
        kind: "budget",
        jobType: `llm-budget:${orgId}:${key}`,
        at: now,
        headline: `LLM budget ${threshold}%: ${org.name.replace(/\s+/g, " ").slice(0, 60)}`,
        summary: `The organisation has used an estimated $${spentUsd.toFixed(2)} of its $${budgetUsd.toFixed(2)} monthly LLM budget (${PLANS[org.plan].name} plan).${threshold === 100 ? " Its weekly bulletins run in economy mode until the month ends." : ""}`,
      },
      log,
      now,
      heartbeat
    );
  } catch (err) {
    // The owners' emails are queued; the operator copy is best effort.
    log.error({ err, orgId }, "llm budget: ops alert failed");
  }
  return threshold === 100 ? "100" : "80";
}
