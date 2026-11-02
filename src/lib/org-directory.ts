import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { subscriptionLabel } from "@/lib/billing/labels";
import { llmBudgetFor, monthStart } from "@/lib/llm-budget";
import { limitsFor } from "@/lib/plans";
import { fromMicros } from "@/llm/pricing";

import type { OrgRow } from "./org-directory-view";

/**
 * Every organisation of the instance with its owner, members, repos and streams, for the
 * instance admin's table (`/admin`, behind requireAdminContext). The one tenant read outside
 * withOrg that spans orgs on purpose: counts, this month's LLM usage sums, the owner's email
 * and the subscription status only, a fixed number of
 * grouped queries however many orgs there are, never rendered for anyone but the admin.
 */
export async function loadOrgDirectory(
  db: PrismaClient,
  { cloud, now = new Date() }: { cloud: boolean; now?: Date }
): Promise<OrgRow[]> {
  const [orgs, repos, streams, members, owners, subscriptions, usage] = await Promise.all([
    db.org.findMany({
      select: {
        id: true,
        name: true,
        createdAt: true,
        plan: true,
        repoLimit: true,
        streamLimit: true,
        planSource: true,
        llmBudgetUsd: true,
      },
    }),
    db.repo.groupBy({ by: ["orgId"], _count: { _all: true } }),
    db.bulletinStream.groupBy({ by: ["orgId"], _count: { _all: true } }),
    db.orgMember.groupBy({ by: ["orgId"], _count: { _all: true } }),
    db.orgMember.findMany({
      where: { role: "owner" },
      orderBy: { createdAt: "asc" },
      select: { orgId: true, user: { select: { email: true } } },
    }),
    cloud
      ? db.subscription.findMany({
          orderBy: { stateAt: "desc" },
          select: { orgId: true, status: true, scheduledChange: true },
        })
      : Promise.resolve([]),
    db.orgUsage.groupBy({
      by: ["orgId"],
      where: { day: { gte: monthStart(now) } },
      _sum: { requests: true, inputTokens: true, outputTokens: true, estimatedUsdMicros: true },
    }),
  ]);
  const monthUsage = new Map(
    usage.map((u) => [
      u.orgId,
      {
        requests: u._sum.requests ?? 0,
        inputTokens: u._sum.inputTokens ?? 0,
        outputTokens: u._sum.outputTokens ?? 0,
        usd: fromMicros(u._sum.estimatedUsdMicros ?? 0),
      },
    ])
  );
  const count = (rows: { orgId: string; _count: { _all: number } }[]) =>
    new Map(rows.map((r) => [r.orgId, r._count._all]));
  const repoCount = count(repos);
  const streamCount = count(streams);
  const memberCount = count(members);
  const ownerEmail = new Map<string, string>();
  for (const o of owners) if (!ownerEmail.has(o.orgId)) ownerEmail.set(o.orgId, o.user.email);
  // Newest first; a live subscription wins over an ended one.
  const subscription = new Map<string, string>();
  for (const sub of [...subscriptions].sort(
    (a, b) => Number(b.status !== "canceled") - Number(a.status !== "canceled")
  )) {
    if (!subscription.has(sub.orgId)) subscription.set(sub.orgId, subscriptionLabel(sub));
  }
  return orgs.map((o) => {
    const limits = limitsFor(o, { cloud });
    return {
      id: o.id,
      name: o.name,
      createdAt: o.createdAt,
      plan: o.plan,
      planSource: o.planSource,
      subscription: subscription.get(o.id) ?? null,
      repoOverride: o.repoLimit,
      streamOverride: o.streamLimit,
      repoLimit: limits.repoLimit,
      streamLimit: limits.streamLimit,
      ownerEmail: ownerEmail.get(o.id) ?? null,
      members: memberCount.get(o.id) ?? 0,
      repos: repoCount.get(o.id) ?? 0,
      streams: streamCount.get(o.id) ?? 0,
      llmBudgetOverride: o.llmBudgetUsd,
      llmBudget: llmBudgetFor(o, { cloud }),
      usage: monthUsage.get(o.id) ?? { requests: 0, inputTokens: 0, outputTokens: 0, usd: 0 },
    };
  });
}
