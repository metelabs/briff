"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
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
  const removed = await removeRepo(withOrg(getDb(), ctx.orgId), id.data);
  if (!removed) return { ok: false, message: "This repo was already removed." };
  for (const path of ["/", "/repos", "/alerts", "/stack", "/streams"]) revalidatePath(path);
  return { ok: true, message: `Removed ${removed.name}.` };
}
