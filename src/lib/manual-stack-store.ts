import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { withOrg, type OrgDb } from "@/lib/db/with-org";
import { isCloud } from "@/lib/env";
import { enqueueJob, scheduleJob } from "@/lib/jobs/queue";
import { log } from "@/lib/log";
import {
  loadOrgLimits,
  OrgLimitError,
  repoLimitMessage,
  stackItemLimitMessage,
} from "@/lib/org-limits";
import { plural } from "@/lib/format";
import { stackItemLimit } from "@/lib/plans";
import { scanFollowUp, scanFollowUpKey } from "@/lib/scan/follow-up";
import { ensurePackages, writeRepoSnapshot } from "@/lib/scan/ingest";
import type { StackSelection } from "@/lib/stack-catalog";
import { setRepoInStreamTx, type StreamCadence } from "@/lib/streams";

import { manualStackRows } from "./manual-stack";

// Manual stacks (Repo.source = manual): stored through the same snapshot writer as scan
// uploads (writeRepoSnapshot), under the org's limits lock, by owners only.

export class ManualStackError extends Error {}

type Tx = Parameters<Parameters<OrgDb["$transaction"]>[0]>[0];

async function lockedOwner(tx: Tx, orgId: string, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(68422::int, hashtext(${orgId}))`;
  const member = await tx.orgMember.findFirst({ where: { userId }, select: { role: true } });
  if (member?.role !== "owner") throw new ManualStackError("Only an owner can change stacks.");
}

export interface SaveManualStack {
  orgId: string;
  userId: string;
  /** null creates a stack. */
  stackId: string | null;
  name: string;
  items: readonly StackSelection[];
  /** Adds the stack to this stream (new stacks only), and sets the stream's cadence. */
  stream?: { id: string; cadence?: StreamCadence } | null;
}

export interface SavedManualStack {
  id: string;
  created: boolean;
  items: number;
}

/**
 * Creates or replaces a manual stack in one transaction: owner check, repo limit (new stacks),
 * stack item limit (all manual stacks of the org), name, rows, stream membership, audit event.
 * Afterwards refresh-packages bootstraps sources for new packages and the org's runtime pass
 * reconciles open runtime security items, as after a scan.
 */
export async function saveManualStack(
  db: PrismaClient,
  input: SaveManualStack,
  now: Date = new Date()
): Promise<SavedManualStack> {
  const { orgId } = input;
  const rows = manualStackRows(input.items);
  const packageIds = await ensurePackages(db, rows.dependencies);
  const itemCount = rows.dependencies.length + rows.runtimes.length;

  const saved = await withOrg(db, orgId).$transaction(async (tx) => {
    await lockedOwner(tx, orgId, input.userId);
    const existing = input.stackId
      ? await tx.repo.findFirst({
          where: { id: input.stackId, source: "manual" },
          select: { id: true, name: true },
        })
      : null;
    if (input.stackId && !existing)
      throw new ManualStackError("That stack does not exist any more.");
    const clash = await tx.repo.findFirst({
      where: {
        source: "manual",
        name: input.name,
        ...(existing ? { id: { not: existing.id } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw new ManualStackError(`A stack named “${input.name}” already exists.`);

    const limits = await loadOrgLimits(tx, orgId);
    if (!existing && limits.repoLimit !== null && (await tx.repo.count()) >= limits.repoLimit)
      throw new OrgLimitError(repoLimitMessage(limits));
    const itemLimit = stackItemLimit(limits.plan, { cloud: isCloud() });
    if (itemLimit !== null) {
      const others = {
        repo: { source: "manual" as const },
        ...(existing ? { repoId: { not: existing.id } } : {}),
      };
      const [deps, runtimes] = await Promise.all([
        tx.dependency.count({ where: others }),
        tx.repoRuntime.count({ where: others }),
      ]);
      if (deps + runtimes + itemCount > itemLimit)
        throw new OrgLimitError(stackItemLimitMessage(itemLimit, limits));
    }

    if (existing && existing.name !== input.name)
      await tx.repo.updateMany({ where: { id: existing.id }, data: { name: input.name } });
    const result = await writeRepoSnapshot(tx, orgId, {
      source: "manual",
      existingId: existing?.id ?? null,
      repo: { name: input.name, path: null, ecosystem: "npm", ...rows },
      packageIds,
      now,
      // The user's list is the whole stack: a package taken off resolves its alerts.
      completeSnapshots: true,
      resolvedBy: "manual_stack",
    });

    if (!existing && input.stream) {
      if (!(await setRepoInStreamTx(tx, orgId, input.stream.id, result.repoId, true)))
        throw new ManualStackError("That stream does not exist any more.");
    }
    if (input.stream?.cadence) {
      await tx.bulletinStream.updateMany({
        where: { id: input.stream.id },
        data: input.stream.cadence,
      });
    }

    const renamed = existing && existing.name !== input.name ? ` (was ${existing.name})` : "";
    await tx.orgEvent.create({
      data: {
        orgId,
        actorUserId: input.userId,
        type: existing ? "stack_updated" : "stack_created",
        detail: `${input.name}${renamed}: ${plural(itemCount, "item")}`,
      },
    });
    return { id: result.repoId, created: !existing, items: itemCount };
  });

  await followUp(db, orgId, now);
  return saved;
}

/** Same jobs as after a final scan upload (src/lib/scan/accept.ts). */
async function followUp(db: PrismaClient, orgId: string, now: Date): Promise<void> {
  try {
    await enqueueJob(db, "refresh-packages");
    await scheduleJob(db, "collect-sources", {
      dedupeKey: scanFollowUpKey(orgId),
      runAfter: scanFollowUp({ scanId: "manual-stack", final: true }, now).runAfter,
      payload: { due: true, rematchOrgId: orgId },
    });
  } catch (err) {
    log.error({ err, orgId }, "manual stack: scheduling the follow-up jobs failed");
  }
}

/** Deletes a manual stack (its rows, alerts and memberships cascade). Owners only. */
export async function deleteManualStack(
  db: PrismaClient,
  args: { orgId: string; userId: string; stackId: string }
): Promise<{ name: string } | null> {
  const { orgId } = args;
  return withOrg(db, orgId).$transaction(async (tx) => {
    await lockedOwner(tx, orgId, args.userId);
    const stack = await tx.repo.findFirst({
      where: { id: args.stackId, source: "manual" },
      select: { id: true, name: true },
    });
    if (!stack) return null;
    await tx.repo.deleteMany({ where: { id: stack.id } });
    await tx.orgEvent.create({
      data: { orgId, actorUserId: args.userId, type: "stack_deleted", detail: stack.name },
    });
    return { name: stack.name };
  });
}

/** A manual stack with its rows, for the edit page; null when it is not a manual stack. */
export async function loadManualStack(db: PrismaClient, orgId: string, stackId: string) {
  return withOrg(db, orgId).repo.findFirst({
    where: { id: stackId, source: "manual" },
    select: {
      id: true,
      name: true,
      dependencies: {
        select: { installedVersion: true, package: { select: { ecosystem: true, name: true } } },
      },
      runtimes: { select: { name: true, version: true } },
    },
  });
}
