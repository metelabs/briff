import { getOrgContext } from "@/lib/auth/session";
import { auditCsvStream } from "@/lib/audit-export";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { log } from "@/lib/log";
import { loadOrgLimits } from "@/lib/org-limits";
import { teamFeaturePlan } from "@/lib/plans";

// Settings → Members → Export audit log: the session's org's OrgEvent rows as CSV. Owners only
// (the Activity list is theirs), and on the hosted service only on plans with `auditExport`.
export async function GET(): Promise<Response> {
  const ctx = await getOrgContext();
  if (!ctx) return Response.json({ error: "Sign in first." }, { status: 401 });
  const db = getDb();
  const scoped = withOrg(db, ctx.orgId);
  const member = await scoped.orgMember.findFirst({
    where: { userId: ctx.userId },
    select: { role: true },
  });
  if (member?.role !== "owner") {
    return Response.json({ error: "Only owners can export the audit log." }, { status: 403 });
  }
  if (!(await loadOrgLimits(db, ctx.orgId)).auditExport) {
    return Response.json(
      { error: `The audit log export is included in ${teamFeaturePlan().name}.` },
      { status: 403 }
    );
  }
  await scoped.orgEvent.create({
    data: { orgId: ctx.orgId, actorUserId: ctx.userId, type: "audit_exported" },
  });
  log.info({ orgId: ctx.orgId, userId: ctx.userId }, "audit log export started");
  const day = new Date().toISOString().slice(0, 10);
  return new Response(auditCsvStream(db, ctx.orgId), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="briff-audit-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
