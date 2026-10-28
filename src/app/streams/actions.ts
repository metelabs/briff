"use server";

import { createLimitedStream, OrgLimitError } from "@/lib/org-limits";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { deleteStream, freeSlug, setStreamRepos, STREAM_NAME_MAX } from "@/lib/streams";

export interface StreamFormState {
  ok: boolean;
  message: string | null;
  /** The saved name, so the input shows it after React resets the form. */
  name?: string;
  /** The saved repo ids, for the same reason. */
  repoIds?: string[];
}

const nameSchema = z.string().trim().min(1).max(STREAM_NAME_MAX);
const idSchema = z.string().min(1).max(100);

function revalidateStreams(): void {
  revalidatePath("/streams");
  revalidatePath("/repos");
  revalidatePath("/bulletins");
}

export async function createStreamAction(
  _prev: StreamFormState,
  form: FormData
): Promise<StreamFormState> {
  const ctx = await requireOrgContext();
  const name = nameSchema.safeParse(form.get("name") ?? "");
  if (!name.success) return { ok: false, message: `Name: 1–${STREAM_NAME_MAX} characters.` };
  try {
    await createLimitedStream(getDb(), ctx.orgId, name.data);
  } catch (err) {
    if (err instanceof OrgLimitError) return { ok: false, message: err.message };
    throw err;
  }
  revalidateStreams();
  return { ok: true, message: `Created “${name.data}”.`, name: "" };
}

export async function renameStreamAction(
  _prev: StreamFormState,
  form: FormData
): Promise<StreamFormState> {
  const ctx = await requireOrgContext();
  const id = idSchema.safeParse(form.get("streamId"));
  const name = nameSchema.safeParse(form.get("name") ?? "");
  if (!id.success) return { ok: false, message: "Unknown stream." };
  if (!name.success) return { ok: false, message: `Name: 1–${STREAM_NAME_MAX} characters.` };
  const db = withOrg(getDb(), ctx.orgId);
  const res = await db.bulletinStream.updateMany({
    where: { id: id.data },
    data: { name: name.data, slug: await freeSlug(db, name.data, id.data) },
  });
  if (res.count !== 1) return { ok: false, message: "Unknown stream." };
  revalidateStreams();
  return { ok: true, message: "Renamed.", name: name.data };
}

export async function saveStreamReposAction(
  _prev: StreamFormState,
  form: FormData
): Promise<StreamFormState> {
  const ctx = await requireOrgContext();
  const id = idSchema.safeParse(form.get("streamId"));
  const repoIds = z.array(idSchema).max(1000).safeParse(form.getAll("repoId").map(String));
  if (!id.success || !repoIds.success) return { ok: false, message: "Invalid input." };
  const db = withOrg(getDb(), ctx.orgId);
  if (!(await setStreamRepos(db, ctx.orgId, id.data, repoIds.data)))
    return { ok: false, message: "Unknown stream." };
  revalidateStreams();
  const n = repoIds.data.length;
  return { ok: true, message: `Saved, ${n} ${n === 1 ? "repo" : "repos"}.`, repoIds: repoIds.data };
}

/** Deleting a stream keeps its bulletins; they lose the stream (streamId set to null). */
export async function deleteStreamAction(streamId: string): Promise<{ ok: boolean }> {
  const ctx = await requireOrgContext();
  const id = idSchema.safeParse(streamId);
  if (!id.success) return { ok: false };
  if (!(await deleteStream(withOrg(getDb(), ctx.orgId), id.data))) return { ok: false };
  revalidateStreams();
  return { ok: true };
}
