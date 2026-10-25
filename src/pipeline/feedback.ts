import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";

import { applyFeedbackChange, parseWeights, type FeedbackKind, type ItemKeys } from "./weights";

/** What an item is about, for this org: matched package/service, source and triaged topic. */
export async function itemKeysFor(
  db: PrismaClient,
  orgId: string,
  itemId: string
): Promise<ItemKeys | null> {
  const scoped = withOrg(db, orgId);
  const match = await scoped.itemMatch.findFirst({
    where: { itemId },
    select: { package: { select: { name: true } }, service: { select: { key: true } } },
  });
  if (!match) return null;
  const item = await db.item.findUnique({
    where: { id: itemId },
    select: { source: { select: { name: true } }, triage: { select: { bucket: true } } },
  });
  if (!item) return null;
  return {
    packages: match.package ? [match.package.name] : [],
    services: match.service ? [match.service.key] : [],
    source: item.source.name,
    topic: item.triage?.bucket ?? null,
  };
}

export type FeedbackOutcome =
  { ok: true; kind: FeedbackKind | null } | { ok: false; reason: string };

/**
 * Sets (or, when the same kind is sent again and `toggle` is on, clears) a user's
 * feedback on an item and moves the org's interest weights in the same transaction.
 */
export async function recordFeedback(
  db: PrismaClient,
  args: { orgId: string; userId: string; itemId: string; kind: FeedbackKind; toggle: boolean }
): Promise<FeedbackOutcome> {
  const keys = await itemKeysFor(db, args.orgId, args.itemId);
  if (!keys) return { ok: false, reason: "item is not part of this org's stack" };
  const scoped = withOrg(db, args.orgId);

  return scoped.$transaction(async (tx) => {
    const previous = await tx.feedback.findFirst({
      where: { userId: args.userId, itemId: args.itemId },
      select: { id: true, kind: true },
    });
    const next: FeedbackKind | null =
      args.toggle && previous?.kind === args.kind ? null : args.kind;
    if (previous?.kind === next) return { ok: true as const, kind: next };

    if (next === null && previous) {
      await tx.feedback.delete({ where: { id: previous.id } });
    } else if (previous && next) {
      await tx.feedback.update({ where: { id: previous.id }, data: { kind: next } });
    } else if (next) {
      await tx.feedback.create({
        data: { orgId: args.orgId, userId: args.userId, itemId: args.itemId, kind: next },
      });
    }

    const profile = await tx.interestProfile.findFirst({ select: { id: true, weights: true } });
    const weights = applyFeedbackChange(
      parseWeights(profile?.weights),
      keys,
      previous?.kind ?? null,
      next
    ) as Prisma.InputJsonValue;
    if (profile) {
      await tx.interestProfile.update({ where: { id: profile.id }, data: { weights } });
    } else {
      await tx.interestProfile.create({ data: { orgId: args.orgId, weights } });
    }
    return { ok: true as const, kind: next };
  });
}
