"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { loadStreamScope, repoScope } from "@/lib/stream-scope";
import { REVIEWABLE } from "@/pipeline/alert-review";

export interface ReviewState {
  ok: boolean;
  message: string | null;
}

const packageSchema = z.string().trim().min(1).max(214);

function revalidateAlerts(): void {
  revalidatePath("/alerts");
  revalidatePath("/");
}

/** Every unreviewed first-scan backlog alert of the org; new alerts are never touched. */
export async function markBacklogReviewedAction(): Promise<ReviewState> {
  const ctx = await requireOrgContext();
  const db = withOrg(getDb(), ctx.orgId);
  const res = await db.alert.updateMany({
    where: { ...REVIEWABLE },
    data: { reviewedAt: new Date() },
  });
  revalidateAlerts();
  return {
    ok: true,
    message: res.count > 0 ? "Backlog marked as reviewed." : "No backlog left to review.",
  };
}

/** One package's unreviewed backlog alerts in the repos of the stream picked in the top bar. */
export async function markPackageReviewedAction(
  _prev: ReviewState,
  form: FormData
): Promise<ReviewState> {
  const ctx = await requireOrgContext();
  const name = packageSchema.safeParse(form.get("packageName") ?? "");
  if (!name.success) return { ok: false, message: "Unknown package." };
  const scope = await loadStreamScope(ctx.orgId);
  const db = withOrg(getDb(), ctx.orgId);
  const res = await db.alert.updateMany({
    where: { ...REVIEWABLE, repo: repoScope(scope), advisory: { package: { name: name.data } } },
    data: { reviewedAt: new Date() },
  });
  revalidateAlerts();
  return res.count > 0
    ? { ok: true, message: `${name.data} marked as reviewed.` }
    : { ok: false, message: `${name.data} has no backlog left to review.` };
}
