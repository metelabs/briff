"use server";

import { z } from "zod";

import { bulletinHasItem, resolveBulletinAccess } from "@/lib/bulletin-access";
import { getDb } from "@/lib/db/client";
import { recordFeedback } from "@/pipeline/feedback";
import type { FeedbackKind } from "@/pipeline/weights";

const inputSchema = z.object({
  bulletinId: z.string().min(1),
  itemId: z.string().min(1),
  kind: z.enum(["up", "down", "less"]),
  token: z.string().max(500).nullable(),
});

export type FeedbackActionResult = { ok: true; kind: FeedbackKind | null } | { ok: false };

/** Toggles feedback from the bulletin page; works with a session or the email's signed token. */
export async function giveFeedbackAction(
  bulletinId: string,
  itemId: string,
  kind: FeedbackKind,
  token: string | null
): Promise<FeedbackActionResult> {
  const parsed = inputSchema.safeParse({ bulletinId, itemId, kind, token });
  if (!parsed.success) return { ok: false };
  const access = await resolveBulletinAccess(parsed.data.bulletinId, parsed.data.token);
  if (!access) return { ok: false };
  if (!(await bulletinHasItem(access.orgId, parsed.data.bulletinId, parsed.data.itemId)))
    return { ok: false };
  const result = await recordFeedback(getDb(), {
    orgId: access.orgId,
    userId: access.userId,
    itemId: parsed.data.itemId,
    kind: parsed.data.kind,
    toggle: true,
  });
  return result.ok ? { ok: true, kind: result.kind } : { ok: false };
}
