"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { STREAM_COOKIE } from "@/lib/stream-scope";
import { THEME_COOKIE, THEMES, type Theme } from "@/lib/theme";

const YEAR = 60 * 60 * 24 * 365;

/** Stores the theme preference; the next server render sets <html data-theme>. */
export async function setThemeAction(theme: Theme): Promise<{ ok: boolean }> {
  const parsed = z.enum(THEMES).safeParse(theme);
  if (!parsed.success) return { ok: false };
  (await cookies()).set(THEME_COOKIE, parsed.data, {
    path: "/",
    maxAge: YEAR,
    sameSite: "lax",
    httpOnly: true,
  });
  return { ok: true };
}

/** Switches the stream every page is scoped to (top bar picker). */
export async function selectStreamAction(streamId: string): Promise<{ ok: boolean }> {
  const ctx = await requireOrgContext();
  const parsed = z.string().min(1).max(100).safeParse(streamId);
  if (!parsed.success) return { ok: false };
  const stream = await withOrg(getDb(), ctx.orgId).bulletinStream.findFirst({
    where: { id: parsed.data },
    select: { id: true },
  });
  if (!stream) return { ok: false };
  (await cookies()).set(STREAM_COOKIE, stream.id, {
    path: "/",
    maxAge: YEAR,
    sameSite: "lax",
    httpOnly: true,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
