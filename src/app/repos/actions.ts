"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { deleteManualStack, ManualStackError } from "@/lib/manual-stack-store";
import { removeRepo } from "@/lib/repo-removal";

export interface RemoveRepoResult {
  ok: boolean;
  message: string;
}

const idSchema = z.string().min(1).max(100);

/** Removes a repo with its dependencies, runtimes, alerts and stream memberships. */
export async function removeRepoAction(repoId: string): Promise<RemoveRepoResult> {
  const ctx = await requireOrgContext();
  const id = idSchema.safeParse(repoId);
  if (!id.success) return { ok: false, message: "Unknown repo." };
  const db = getDb();
  const repo = await withOrg(db, ctx.orgId).repo.findFirst({
    where: { id: id.data },
    select: { source: true },
  });
  // A manual stack is deleted only by an owner, with its audit event (src/lib/manual-stack-store.ts).
  if (repo?.source === "manual") {
    try {
      const gone = await deleteManualStack(db, {
        orgId: ctx.orgId,
        userId: ctx.userId,
        stackId: id.data,
      });
      if (!gone) return { ok: false, message: "This repo was already removed." };
      for (const path of ["/", "/repos", "/alerts", "/stack", "/streams"]) revalidatePath(path);
      return { ok: true, message: `Removed ${gone.name}.` };
    } catch (err) {
      if (err instanceof ManualStackError) return { ok: false, message: err.message };
      throw err;
    }
  }
  const removed = await removeRepo(withOrg(db, ctx.orgId), id.data);
  if (!removed) return { ok: false, message: "This repo was already removed." };
  for (const path of ["/", "/repos", "/alerts", "/stack", "/streams"]) revalidatePath(path);
  return { ok: true, message: `Removed ${removed.name}.` };
}
