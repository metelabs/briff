import "server-only";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { findInstanceAdmin } from "@/lib/admin";
import { getAuth } from "@/lib/auth/auth";
import { loadRuntimeLifecycle } from "@/lib/runtime-eol-catalog";
import { getDb } from "@/lib/db/client";
import type { OrgRole } from "@/generated/prisma/client";

/** The org a user with several memberships works in; never trusted without a membership. */
export const ORG_COOKIE = "briff-org";

export interface OrgContext {
  userId: string;
  email: string;
  name: string;
  emailVerified: boolean;
  orgId: string;
  role: OrgRole;
}

export interface SessionUser {
  userId: string;
  email: string;
  name: string;
}

/** The signed-in user without an org (invite page: the account may not belong to it yet). */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  return { userId: session.user.id, email: session.user.email, name: session.user.name };
}

export async function getOrgContext(): Promise<OrgContext | null> {
  // Read request headers before touching config: this marks the route dynamic,
  // so `next build` never evaluates auth or the database.
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;
  // Resolving which org the user belongs to is the one tenant read that cannot be org-scoped
  // yet. The cookie only picks among the user's own memberships; else the oldest one.
  const [memberships, jar] = await Promise.all([
    getDb().orgMember.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "asc" },
      select: { orgId: true, role: true },
    }),
    cookies(),
  ]);
  const chosen = jar.get(ORG_COOKIE)?.value;
  const membership = memberships.find((m) => m.orgId === chosen) ?? memberships[0];
  if (!membership) return null;
  await loadRuntimeLifecycle(getDb());
  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    emailVerified: session.user.emailVerified,
    orgId: membership.orgId,
    role: membership.role,
  };
}

export interface UserOrg {
  id: string;
  name: string;
  role: OrgRole;
}

/** The org switcher's list: the user's own memberships, oldest first (same read as above). */
export async function listUserOrgs(userId: string): Promise<UserOrg[]> {
  const rows = await getDb().orgMember.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { role: true, org: { select: { id: true, name: true } } },
  });
  return rows.map((r) => ({ id: r.org.id, name: r.org.name, role: r.role }));
}

export async function requireOrgContext(): Promise<OrgContext> {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  return ctx;
}

/** The first account bootstraps the instance and is its admin. */
export async function isInstanceAdmin(userId: string): Promise<boolean> {
  return (await findInstanceAdmin(getDb()))?.id === userId;
}

/** Page guard for owner-only pages and sections' server checks. */
export async function requireOwnerContext(): Promise<OrgContext> {
  const ctx = await requireOrgContext();
  if (ctx.role !== "owner") redirect("/settings");
  return ctx;
}

export async function requireAdminContext(): Promise<OrgContext> {
  const ctx = await requireOrgContext();
  if (!(await isInstanceAdmin(ctx.userId))) redirect("/bulletins");
  return ctx;
}
