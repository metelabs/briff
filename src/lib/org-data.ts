import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { maskUrl } from "@/lib/delivery-targets/format";
import { ensureUserHasOrg, lockMembers } from "@/lib/members";

// "Your data" (Settings): the org's export and its deletion. docs/PRIVACY.md lists what
// each holds. Every tenant read goes through withOrg; the user rows are the members' own.

export const EXPORT_VERSION = 1;

/**
 * The export as named sections, each loaded only when the stream reaches it, so a large
 * org is never held in memory as one object. Secrets are never part of it: scan tokens
 * appear without their hash, invites without their link's hash, delivery targets without their
 * secret and with a masked URL, users without sessions,
 * accounts or password hashes.
 */
export function orgExportSections(
  db: PrismaClient,
  orgId: string
): [string, () => Promise<unknown>][] {
  const scoped = withOrg(db, orgId);
  return [
    [
      "org",
      () =>
        db.org.findUniqueOrThrow({
          where: { id: orgId },
          select: {
            id: true,
            name: true,
            createdAt: true,
            plan: true,
            planUpdatedAt: true,
            planSource: true,
            repoLimit: true,
            streamLimit: true,
            baseImageAlerts: true,
          },
        }),
    ],
    [
      "members",
      () =>
        scoped.orgMember.findMany({
          orderBy: { createdAt: "asc" },
          select: {
            role: true,
            createdAt: true,
            onboardedAt: true,
            alertsSeenAt: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                language: true,
                deliveryEmail: true,
                createdAt: true,
              },
            },
          },
        }),
    ],
    [
      "invites",
      () =>
        scoped.orgInvite.findMany({
          orderBy: { createdAt: "asc" },
          select: {
            email: true,
            role: true,
            invitedByUserId: true,
            createdAt: true,
            sentAt: true,
            expiresAt: true,
            acceptedAt: true,
            revokedAt: true,
          },
        }),
    ],
    [
      "events",
      () =>
        scoped.orgEvent.findMany({
          orderBy: { createdAt: "asc" },
          select: {
            type: true,
            actorUserId: true,
            targetEmail: true,
            targetUserId: true,
            detail: true,
            createdAt: true,
          },
        }),
    ],
    [
      "deliveryTargets",
      async () =>
        (
          await scoped.deliveryTarget.findMany({
            orderBy: { createdAt: "asc" },
            select: {
              kind: true,
              url: true,
              streamId: true,
              bulletin: true,
              alert: true,
              enabled: true,
              lastDeliveredAt: true,
              lastError: true,
              createdAt: true,
            },
          })
        ).map(({ url, ...t }) => ({ ...t, url: maskUrl(url) })),
    ],
    [
      "profile",
      () =>
        scoped.interestProfile.findFirst({
          select: {
            text: true,
            weights: true,
            refreshedAt: true,
            model: true,
            promptVersion: true,
            updatedAt: true,
          },
        }),
    ],
    [
      "scanTokens",
      () =>
        scoped.scanToken.findMany({
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            name: true,
            prefix: true,
            createdAt: true,
            lastUsedAt: true,
            revokedAt: true,
            createdByUserId: true,
          },
        }),
    ],
    [
      "subscriptions",
      () =>
        scoped.subscription.findMany({
          orderBy: { createdAt: "asc" },
          select: {
            paddleSubscriptionId: true,
            plan: true,
            interval: true,
            status: true,
            currentPeriodEnd: true,
            nextBilledAt: true,
            scheduledChange: true,
            canceledAt: true,
            createdAt: true,
          },
        }),
    ],
    ["baseImageAlerts", () => scoped.baseImageAlert.findMany({ orderBy: { createdAt: "asc" } })],
    [
      "usage",
      () =>
        scoped.orgUsage.findMany({
          orderBy: { day: "asc" },
          select: {
            day: true,
            requests: true,
            bulletins: true,
            inputTokens: true,
            outputTokens: true,
            estimatedUsdMicros: true,
            scanUploads: true,
          },
        }),
    ],
    ["baseImageWatches", () => scoped.baseImageWatch.findMany({ orderBy: { since: "asc" } })],
    [
      "repos",
      () =>
        scoped.repo.findMany({
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            source: true,
            path: true,
            ecosystem: true,
            included: true,
            includedChangedAt: true,
            firstSeenAt: true,
            lastScannedAt: true,
            securityScannedAt: true,
            createdAt: true,
          },
        }),
    ],
    [
      "dependencies",
      async () =>
        (
          await scoped.dependency.findMany({
            orderBy: [{ repoId: "asc" }, { id: "asc" }],
            select: {
              repoId: true,
              installedVersion: true,
              direct: true,
              createdAt: true,
              package: { select: { ecosystem: true, name: true } },
            },
          })
        ).map(({ package: pkg, ...d }) => ({ ...d, ecosystem: pkg.ecosystem, package: pkg.name })),
    ],
    [
      "runtimes",
      () =>
        scoped.repoRuntime.findMany({
          orderBy: [{ repoId: "asc" }, { name: "asc" }],
          select: {
            repoId: true,
            name: true,
            version: true,
            normalized: true,
            source: true,
            unresolved: true,
            image: true,
            constraint: true,
            updatedAt: true,
          },
        }),
    ],
    [
      "streams",
      async () =>
        (
          await scoped.bulletinStream.findMany({
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              name: true,
              slug: true,
              createdAt: true,
              repos: { select: { repoId: true } },
            },
          })
        ).map(({ repos, ...s }) => ({ ...s, repoIds: repos.map((r) => r.repoId) })),
    ],
    [
      "bulletins",
      () =>
        scoped.bulletin.findMany({
          orderBy: { weekStart: "asc" },
          select: {
            id: true,
            streamId: true,
            weekStart: true,
            periodStart: true,
            periodEnd: true,
            language: true,
            model: true,
            promptVersion: true,
            subject: true,
            summary: true,
            minorCount: true,
            emailStatus: true,
            emailSentAt: true,
            preview: true,
            previewKey: true,
            createdAt: true,
          },
        }),
    ],
    [
      "bulletinItems",
      async () =>
        (
          await scoped.bulletinItem.findMany({
            orderBy: [{ bulletinId: "asc" }, { order: "asc" }],
            select: {
              bulletinId: true,
              bucket: true,
              section: true,
              order: true,
              headline: true,
              line: true,
              action: true,
              todo: true,
              affectedRepos: true,
              upgrades: true,
              item: { select: { title: true, url: true, publishedAt: true } },
            },
          })
        ).map(({ item, ...i }) => ({ ...i, item })),
    ],
    [
      "alerts",
      async () =>
        (
          await scoped.alert.findMany({
            orderBy: { createdAt: "asc" },
            select: {
              repoId: true,
              kind: true,
              deliveredAt: true,
              reviewedAt: true,
              createdAt: true,
              advisory: {
                select: {
                  osvId: true,
                  severity: true,
                  summary: true,
                  fixedVersion: true,
                  url: true,
                  package: { select: { name: true } },
                },
              },
            },
          })
        ).map(({ advisory: { package: pkg, ...advisory }, ...a }) => ({
          ...a,
          advisory: { ...advisory, package: pkg.name },
        })),
    ],
    [
      "feedback",
      () =>
        scoped.feedback.findMany({
          orderBy: { createdAt: "asc" },
          select: {
            userId: true,
            kind: true,
            tag: true,
            createdAt: true,
            item: { select: { title: true, url: true } },
          },
        }),
    ],
    [
      "githubInstallations",
      () =>
        scoped.githubInstallation.findMany({
          orderBy: { createdAt: "asc" },
          select: {
            installationId: true,
            accountLogin: true,
            accountType: true,
            suspendedAt: true,
            createdAt: true,
          },
        }),
    ],
    [
      "deadlines",
      () =>
        scoped.deadline.findMany({
          orderBy: { dueAt: "asc" },
          select: {
            what: true,
            dueAt: true,
            affectedRepos: true,
            confirmed: true,
            item: { select: { title: true, url: true } },
          },
        }),
    ],
  ];
}

/**
 * Streams `{ "format": ..., "exportedAt": ..., "<section>": ..., ... }` one section at a
 * time. A failing section aborts the stream (the download then fails rather than
 * silently missing data).
 */
export function orgExportStream(
  db: PrismaClient,
  orgId: string,
  now: Date = new Date()
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const sections = orgExportSections(db, orgId);
  let index = -1;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index === -1) {
        const head = { format: `briff-export-v${EXPORT_VERSION}`, exportedAt: now.toISOString() };
        controller.enqueue(encoder.encode(JSON.stringify(head).slice(0, -1)));
        index = 0;
        return;
      }
      if (index >= sections.length) {
        controller.enqueue(encoder.encode("}\n"));
        controller.close();
        return;
      }
      const [name, load] = sections[index++];
      const value = await load();
      controller.enqueue(encoder.encode(`,${JSON.stringify(name)}:${JSON.stringify(value)}`));
    },
  });
}

export type DeleteOrgResult =
  | { ok: true; userDeleted: boolean }
  | { ok: false; reason: "not-owner" | "name-mismatch" | "instance-admin" }
  | { ok: false; reason: "billing"; message: string };

/**
 * Deletes the org and everything attached to it (every tenant table cascades from Org),
 * plus its pending jobs. When the user belonged to no other org, deletes the user too
 * (sessions, accounts and feedback cascade). The caller then clears the session cookie.
 * Other members keep their accounts (`ensureUserHasOrg`).
 */
export async function deleteOrg(
  db: PrismaClient,
  args: {
    orgId: string;
    userId: string;
    confirmName: string;
    /**
     * Runs inside the delete transaction once the owner role is confirmed under the membership
     * lock; a message refuses the delete (endSubscriptions).
     */
    beforeDelete?: () => Promise<string | null>;
  }
): Promise<DeleteOrgResult> {
  const scoped = withOrg(db, args.orgId);
  const membership = await scoped.orgMember.findFirst({
    where: { userId: args.userId },
    select: { role: true },
  });
  if (membership?.role !== "owner") return { ok: false, reason: "not-owner" };
  const org = await db.org.findUniqueOrThrow({ where: { id: args.orgId }, select: { name: true } });
  if (args.confirmName.trim() !== org.name.trim()) return { ok: false, reason: "name-mismatch" };

  // The oldest user is the instance admin (isInstanceAdmin). Deleting that user while others
  // exist would silently make the next-oldest account admin, so it is refused.
  const [self, admin, users] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: args.userId },
      select: {
        _count: { select: { memberships: { where: { orgId: { not: args.orgId } } } } },
      },
    }),
    db.user.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } }),
    db.user.count(),
  ]);
  const userGoes = self._count.memberships === 0;
  if (userGoes && admin?.id === args.userId && users > 1) {
    return { ok: false, reason: "instance-admin" };
  }
  let others: string[] = [];
  const result = await scoped.$transaction(
    async (tx): Promise<DeleteOrgResult> => {
      // Under the membership lock: an owner demoted or removed since the check above may not
      // delete the org.
      await lockMembers(tx, args.orgId);
      const still = await tx.orgMember.findFirst({
        where: { userId: args.userId },
        select: { role: true },
      });
      if (still?.role !== "owner") return { ok: false, reason: "not-owner" };
      // Only now, with the role confirmed under the lock: canceling a subscription is not undone.
      const refused = args.beforeDelete ? await args.beforeDelete() : null;
      if (refused) return { ok: false, reason: "billing", message: refused };
      others = (
        await tx.orgMember.findMany({
          where: { userId: { not: args.userId } },
          select: { userId: true },
        })
      ).map((m) => m.userId);
      // Pending jobs that name this org (e.g. a legacy bulletin preview) would only fail on retry.
      await tx.job.deleteMany({
        where: { status: "pending", payload: { path: ["orgId"], equals: args.orgId } },
      });
      await tx.org.delete({ where: { id: args.orgId } });
      // Like getOrgContext, a read of the user's own memberships across orgs: one elsewhere
      // keeps the user.
      const user = await tx.user.findUniqueOrThrow({
        where: { id: args.userId },
        select: { _count: { select: { memberships: true } } },
      });
      if (user._count.memberships > 0) return { ok: true, userDeleted: false };
      await tx.user.delete({ where: { id: args.userId } });
      return { ok: true, userDeleted: true };
    },
    // beforeDelete may call the Paddle API inside the transaction.
    { timeout: 30_000 }
  );
  // The other members keep their accounts; one left without any org gets a new one.
  if (result.ok) for (const userId of others) await ensureUserHasOrg(db, userId);
  return result;
}
