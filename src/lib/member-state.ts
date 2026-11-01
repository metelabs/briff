import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";

// Per-member UI state on OrgMember: onboarding shown once, and when /alerts was last seen.

export interface MemberState {
  onboardedAt: Date | null;
  alertsSeenAt: Date | null;
}

/** First run only: no repo in a stream yet and the member has not finished or skipped it. */
export function needsOnboarding(includedRepos: number, onboardedAt: Date | null): boolean {
  return includedRepos === 0 && onboardedAt === null;
}

/**
 * Alerts behind the top bar's dot: new-kind alerts created after the member last opened
 * /alerts (every new-kind alert before the first visit). Backlog alerts never light it.
 */
export function unseenAlertsWhere(alertsSeenAt: Date | null): Prisma.AlertWhereInput {
  return alertsSeenAt
    ? { kind: "new", resolvedAt: null, createdAt: { gt: alertsSeenAt } }
    : { kind: "new", resolvedAt: null };
}

export async function loadMemberState(
  db: PrismaClient,
  orgId: string,
  userId: string
): Promise<MemberState> {
  const member = await withOrg(db, orgId).orgMember.findFirst({
    where: { userId },
    select: { onboardedAt: true, alertsSeenAt: true },
  });
  return { onboardedAt: member?.onboardedAt ?? null, alertsSeenAt: member?.alertsSeenAt ?? null };
}

/** Whether the alerts dot shows: unseen new alerts on the repos in `repo` scope. */
export async function hasUnseenAlerts(
  db: PrismaClient,
  orgId: string,
  userId: string,
  repo: Prisma.RepoWhereInput
): Promise<boolean> {
  const { alertsSeenAt } = await loadMemberState(db, orgId, userId);
  const unseen = await withOrg(db, orgId).alert.findFirst({
    where: { ...unseenAlertsWhere(alertsSeenAt), repo },
    select: { id: true },
  });
  return unseen !== null;
}

export async function markAlertsSeen(
  db: PrismaClient,
  orgId: string,
  userId: string,
  at = new Date()
): Promise<void> {
  await withOrg(db, orgId).orgMember.updateMany({ where: { userId }, data: { alertsSeenAt: at } });
}

/** Sets the flag once; a later finish or skip keeps the first time. */
export async function markOnboarded(
  db: PrismaClient,
  orgId: string,
  userId: string,
  at = new Date()
): Promise<void> {
  await withOrg(db, orgId).orgMember.updateMany({
    where: { userId, onboardedAt: null },
    data: { onboardedAt: at },
  });
}

export async function shouldOnboard(
  db: PrismaClient,
  orgId: string,
  userId: string
): Promise<boolean> {
  const [included, state] = await Promise.all([
    withOrg(db, orgId).repo.count({ where: { included: true } }),
    loadMemberState(db, orgId, userId),
  ]);
  return needsOnboarding(included, state.onboardedAt);
}
