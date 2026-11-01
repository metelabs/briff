import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/lib/auth/auth";
import { loadRuntimeLifecycle } from "@/lib/runtime-eol-catalog";
import { getDb } from "@/lib/db/client";

export interface OrgContext {
  userId: string;
  email: string;
  name: string;
  emailVerified: boolean;
  orgId: string;
}

export async function getOrgContext(): Promise<OrgContext | null> {
  // Read request headers before touching config: this marks the route dynamic,
  // so `next build` never evaluates auth or the database.
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;
  // Resolving which org the user belongs to is the one tenant read that cannot be org-scoped yet.
  const membership = await getDb().orgMember.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
  });
  if (!membership) return null;
  await loadRuntimeLifecycle(getDb());
  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    emailVerified: session.user.emailVerified,
    orgId: membership.orgId,
  };
}

export async function requireOrgContext(): Promise<OrgContext> {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  return ctx;
}

/** The first account bootstraps the instance and is its admin. */
export async function isInstanceAdmin(userId: string): Promise<boolean> {
  const first = await getDb().user.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return first?.id === userId;
}

export async function requireAdminContext(): Promise<OrgContext> {
  const ctx = await requireOrgContext();
  if (!(await isInstanceAdmin(ctx.userId))) redirect("/bulletins");
  return ctx;
}
