import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { planAllowance, type PlanId } from "@/lib/plans";
import { removeRepo } from "@/lib/repo-removal";

export interface InstallationRow {
  id: string;
  orgId: string;
  installationId: string;
  accountLogin: string;
  suspendedAt: Date | null;
}

const ROW = {
  id: true,
  orgId: true,
  installationId: true,
  accountLogin: true,
  suspendedAt: true,
} as const;

/**
 * The installation a webhook or scan job names. Like the scan token lookup, this read runs
 * before the org is known; everything after it goes through withOrg(row.orgId).
 */
export function findInstallation(
  db: PrismaClient,
  installationId: string
): Promise<InstallationRow | null> {
  return db.githubInstallation.findUnique({ where: { installationId }, select: ROW });
}

export type LinkResult = "linked" | "already-linked" | "other-org" | "at-limit";

/**
 * Links an installation to the org that completed the setup flow. An installation belongs
 * to exactly one org (installationId is unique); linking it again from the same org only
 * refreshes the account fields. A new one past the plan's `limit` (null = unlimited) is
 * refused; the count and the insert run under a per-org lock.
 */
export async function linkInstallation(
  db: PrismaClient,
  args: {
    orgId: string;
    installationId: string;
    accountLogin: string;
    accountType: string;
    suspendedAt: Date | null;
    limit?: number | null;
  }
): Promise<LinkResult> {
  const existing = await findInstallation(db, args.installationId);
  if (existing && existing.orgId !== args.orgId) return "other-org";
  const scoped = withOrg(db, args.orgId);
  const data = {
    accountLogin: args.accountLogin,
    accountType: args.accountType,
    suspendedAt: args.suspendedAt,
  };
  if (existing) {
    await scoped.githubInstallation.updateMany({ where: { id: existing.id }, data });
    return "already-linked";
  }
  try {
    return await scoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`github-installs:${args.orgId}`}))`;
      const limit = args.limit ?? null;
      if (limit !== null && (await tx.githubInstallation.count()) >= limit) return "at-limit";
      await tx.githubInstallation.create({
        data: { orgId: args.orgId, installationId: args.installationId, ...data },
      });
      return "linked";
    });
  } catch (err) {
    // A concurrent setup for the same installation won the unique key.
    const again = await findInstallation(db, args.installationId);
    if (again && again.orgId !== args.orgId) return "other-org";
    if (again) return "already-linked";
    throw err;
  }
}

/** Uninstalled on GitHub: the row goes, its repos stay (unlinked) with their data. */
export async function forgetInstallation(
  db: PrismaClient,
  installationId: string
): Promise<boolean> {
  const row = await findInstallation(db, installationId);
  if (!row) return false;
  await withOrg(db, row.orgId).githubInstallation.deleteMany({ where: { id: row.id } });
  return true;
}

export async function setInstallationSuspended(
  db: PrismaClient,
  installationId: string,
  suspended: boolean,
  now: Date = new Date()
): Promise<boolean> {
  const row = await findInstallation(db, installationId);
  if (!row) return false;
  await withOrg(db, row.orgId).githubInstallation.updateMany({
    where: { id: row.id },
    data: { suspendedAt: suspended ? now : null },
  });
  return true;
}

/**
 * Repos taken out of the installation are removed, but only those the app brought in
 * (a repo the Action uploads stays until the user removes it).
 */
export async function removeInstallationRepos(
  db: PrismaClient,
  row: InstallationRow,
  fullNames: string[]
): Promise<string[]> {
  const scoped = withOrg(db, row.orgId);
  const repos = await scoped.repo.findMany({
    where: { source: "github", name: { in: fullNames }, githubInstallationId: row.id },
    select: { id: true },
  });
  const removed: string[] = [];
  for (const repo of repos) {
    const gone = await removeRepo(scoped, repo.id);
    if (gone) removed.push(gone.name);
  }
  return removed;
}

/** The org's linked installations and its plan's limit (null = unlimited). */
export async function installationCapacity(
  db: PrismaClient,
  orgId: string,
  cloud: boolean
): Promise<{ used: number; limit: number | null; plan: PlanId }> {
  const [org, used] = await Promise.all([
    db.org.findUniqueOrThrow({ where: { id: orgId }, select: { plan: true } }),
    withOrg(db, orgId).githubInstallation.count(),
  ]);
  return { used, limit: planAllowance(org.plan, "githubInstallations", { cloud }), plan: org.plan };
}
