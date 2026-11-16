"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import {
  cleanSelections,
  stackSelectionSchema,
  STACK_ITEMS_MAX,
  STACK_NAME_MAX,
} from "@/lib/manual-stack";
import { deleteManualStack, ManualStackError, saveManualStack } from "@/lib/manual-stack-store";
import { markOnboarded } from "@/lib/member-state";
import { OrgLimitError } from "@/lib/org-limits";
import { isPickableEcosystem } from "@/lib/stack-catalog";
import { checkGithubRepo, suggestPackages, type PackageSuggestions } from "@/lib/stack-lookup";
import { cadenceOf, DEFAULT_STREAM } from "@/lib/streams";

export interface SaveStackResult {
  ok: boolean;
  message: string;
  id?: string;
}

const idSchema = z.string().min(1).max(100);

const saveSchema = z.object({
  stackId: idSchema.nullable(),
  name: z.string().trim().min(1).max(STACK_NAME_MAX),
  items: z.array(stackSelectionSchema).max(STACK_ITEMS_MAX),
  /** New stacks: the stream to add it to; null keeps it out of every stream. */
  streamId: idSchema.nullable().optional(),
  /** First run: the stack goes into the default stream with this cadence. */
  onboarding: z.enum(["weekly", "security", "both"]).optional(),
});

function revalidateStacks(): void {
  for (const path of ["/", "/stack", "/repos", "/streams", "/alerts"]) revalidatePath(path);
}

/** Creates or replaces a manual stack (owners only, checked in the transaction). */
export async function saveStackAction(input: z.input<typeof saveSchema>): Promise<SaveStackResult> {
  const ctx = await requireOrgContext();
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: `Name: 1–${STACK_NAME_MAX} characters, and at most ${STACK_ITEMS_MAX} items.`,
    };
  }
  const { stackId, name, items, streamId, onboarding } = parsed.data;
  if (items.length === 0) return { ok: false, message: "Pick at least one item." };
  const clean = cleanSelections(items);
  if (!clean.ok) return { ok: false, message: clean.message };

  const db = getDb();
  let stream: { id: string; cadence?: ReturnType<typeof cadenceOf> } | null = null;
  if (onboarding) {
    const weekly = await withOrg(db, ctx.orgId).bulletinStream.findFirst({
      where: { slug: DEFAULT_STREAM.slug },
      select: { id: true },
    });
    const first =
      weekly ??
      (await withOrg(db, ctx.orgId).bulletinStream.findFirst({
        orderBy: { createdAt: "asc" },
        select: { id: true },
      }));
    if (!first) return { ok: false, message: "Create a stream first." };
    stream = { id: first.id, cadence: cadenceOf(onboarding) };
  } else if (!stackId && streamId) {
    stream = { id: streamId };
  }

  try {
    const saved = await saveManualStack(db, {
      orgId: ctx.orgId,
      userId: ctx.userId,
      stackId,
      name,
      items: clean.items,
      stream,
    });
    if (onboarding) await markOnboarded(db, ctx.orgId, ctx.userId);
    revalidateStacks();
    return {
      ok: true,
      id: saved.id,
      message: saved.created ? `Created “${name}”.` : `Saved “${name}”.`,
    };
  } catch (err) {
    if (err instanceof OrgLimitError || err instanceof ManualStackError)
      return { ok: false, message: err.message };
    throw err;
  }
}

export async function deleteStackAction(stackId: string): Promise<SaveStackResult> {
  const ctx = await requireOrgContext();
  const id = idSchema.safeParse(stackId);
  if (!id.success) return { ok: false, message: "Unknown stack." };
  try {
    const removed = await deleteManualStack(getDb(), {
      orgId: ctx.orgId,
      userId: ctx.userId,
      stackId: id.data,
    });
    if (!removed) return { ok: false, message: "This stack was already deleted." };
    revalidateStacks();
    return { ok: true, message: `Deleted “${removed.name}”.` };
  } catch (err) {
    if (err instanceof ManualStackError) return { ok: false, message: err.message };
    throw err;
  }
}

/** Typeahead for the picker's package field. */
export async function suggestPackagesAction(
  ecosystem: string,
  query: string
): Promise<PackageSuggestions> {
  await requireOrgContext();
  if (!isPickableEcosystem(ecosystem) || query.length > 300)
    return { known: [], exact: { status: "invalid" } };
  return suggestPackages(getDb(), ecosystem, query);
}

/** Checks a typed `owner/repo` tool against the GitHub API. */
export async function checkToolAction(name: string) {
  await requireOrgContext();
  return checkGithubRepo(name.slice(0, 200));
}
