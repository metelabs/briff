// Renders the latest bulletin email of each stream (or the one given), a security
// alert email, an urgent email, the test email, the account emails (reset, verification,
// email change, invite), the billing emails and the operator alert emails from the local database into files, without
// sending anything.
//   npm run email:preview -- [--bulletin <id>] [--out <dir>]
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { getEnv } from "@/lib/env";
import {
  renderSecurityAlertEmail,
  renderTestEmail,
  renderUrgentEmail,
} from "@/lib/email/alert-email";
import { renderPasswordResetEmail, renderVerificationEmail } from "@/lib/email/account-email";
import { renderBulletinEmail } from "@/lib/email/bulletin-email";
import { renderBillingEmail } from "@/lib/email/billing-email";
import { renderInviteEmail } from "@/lib/email/invite-email";
import { renderOpsAlertEmail } from "@/lib/email/ops-email";
import { signFeedbackToken } from "@/lib/feedback-token";
import { PRODUCT_LANGUAGE } from "@/lib/i18n";
import { loadBulletinView } from "@/pipeline/bulletin-view";
import { backlogSummary, emailsImmediately, type AlertGroup } from "@/security/plan";
import type { OsvRange } from "@/sources/osv";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { bulletin: { type: "string" }, out: { type: "string", default: "email-preview" } },
  });
  const env = getEnv();
  const db = getDb();
  const out = path.resolve(values.out ?? "email-preview");
  mkdirSync(out, { recursive: true });
  const write = (name: string, email: { subject: string; html: string; text: string }) => {
    writeFileSync(path.join(out, `${name}.html`), email.html);
    writeFileSync(path.join(out, `${name}.txt`), `Subject: ${email.subject}\n\n${email.text}`);
    console.log(`${name}: ${email.subject}`);
  };

  // Operator alerts need no org: rendered first, from fixed sample values.
  const opsSample = {
    jobType: "security-scan",
    at: new Date("2026-11-02T04:03:12Z"),
    lastSuccessAt: new Date("2026-11-01T04:02:40Z"),
    baseUrl: env.BETTER_AUTH_URL,
  };
  write(
    "ops-failed",
    renderOpsAlertEmail({
      ...opsSample,
      kind: "failed",
      attempts: 5,
      suppressed: 0,
      error:
        "Error: OSV querybatch failed: 503 Service Unavailable\n    at queryBatch (src/sources/osv.ts:212:11)\n    at async securityScan (src/security/scan.ts:88:5)\n    at async runJob (src/worker/runner.ts:61:20)",
    })
  );
  write(
    "ops-stale",
    renderOpsAlertEmail({
      ...opsSample,
      jobType: "collect-sources",
      kind: "stale",
      at: new Date("2026-11-02T07:02:40Z"),
      error: null,
      suppressed: 0,
    })
  );

  const org = await db.org.findFirstOrThrow({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const scoped = withOrg(db, org.id);
  const owner = await scoped.orgMember.findFirstOrThrow({
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  });

  const targets: { name: string; id: string }[] = [];
  if (values.bulletin) targets.push({ name: "bulletin", id: values.bulletin });
  else {
    const streams = await scoped.bulletinStream.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        slug: true,
        bulletins: { orderBy: { weekStart: "desc" }, take: 1, select: { id: true } },
      },
    });
    for (const s of streams) {
      if (s.bulletins[0]) targets.push({ name: `bulletin-${s.slug}`, id: s.bulletins[0].id });
    }
  }
  for (const target of targets) {
    const view = await loadBulletinView(db, org.id, target.id);
    if (view) {
      const token = signFeedbackToken(env.BETTER_AUTH_SECRET, view.id, owner.userId);
      write(target.name, renderBulletinEmail(view, { baseUrl: env.BETTER_AUTH_URL, token }));
    }
  }

  const alerts = await scoped.alert.findMany({
    where: { repo: { included: true } },
    select: {
      repo: { select: { name: true } },
      repoId: true,
      kind: true,
      advisory: {
        select: {
          osvId: true,
          summary: true,
          severity: true,
          affected: true,
          fixedVersion: true,
          package: { select: { id: true, name: true } },
        },
      },
    },
  });
  // Same split as production (splitPending): new critical/high one by one, backlog summarised.
  const groups = new Map<string, AlertGroup>();
  for (const a of alerts.filter(
    (x) => x.kind === "new" && emailsImmediately(x.advisory.severity)
  )) {
    const dep = await scoped.dependency.findFirst({
      where: { repoId: a.repoId, packageId: a.advisory.package.id },
      select: { installedVersion: true, direct: true },
    });
    const g = groups.get(a.advisory.osvId) ?? {
      osvId: a.advisory.osvId,
      packageName: a.advisory.package.name,
      summary: a.advisory.summary,
      severity: a.advisory.severity,
      affected: a.advisory.affected as unknown as OsvRange[],
      fallbackFixed: a.advisory.fixedVersion,
      repos: [],
    };
    g.repos.push({
      name: a.repo.name,
      installedVersion: dep?.installedVersion ?? "?",
      direct: dep?.direct ?? false,
    });
    groups.set(a.advisory.osvId, g);
  }
  if (groups.size > 0)
    write(
      "security-alert",
      renderSecurityAlertEmail(PRODUCT_LANGUAGE, [...groups.values()], null, env.BETTER_AUTH_URL)
    );
  const firstScan = backlogSummary(
    alerts.filter((a) => a.kind === "backlog").map((a) => ({ ...a, advisoryId: a.advisory.osvId }))
  );
  if (firstScan) {
    write(
      "security-first-scan",
      renderSecurityAlertEmail(
        PRODUCT_LANGUAGE,
        [],
        {
          ...firstScan,
          url: `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/bulletins`,
        },
        env.BETTER_AUTH_URL
      )
    );
  }

  const urgent = await db.itemTriage.findMany({
    where: { bucket: "security" },
    take: 5,
    select: {
      bucket: true,
      reason: true,
      item: { select: { title: true, url: true, source: { select: { name: true } } } },
    },
  });
  if (urgent.length > 0) {
    write(
      "urgent",
      renderUrgentEmail(
        PRODUCT_LANGUAGE,
        urgent.map((u) => ({
          title: u.item.title,
          url: u.item.url,
          bucket: "security" as const,
          reason: u.reason,
          sourceName: u.item.source.name,
          affectedRepos: [],
        })),
        env.BETTER_AUTH_URL
      )
    );
  }
  write("test", renderTestEmail(PRODUCT_LANGUAGE, env.BETTER_AUTH_URL));
  // Sample links shaped like Better Auth's; the tokens are placeholders.
  const authBase = `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/api/auth`;
  write(
    "reset-password",
    renderPasswordResetEmail(
      `${authBase}/reset-password/sample-token?callbackURL=%2Freset-password`,
      env.BETTER_AUTH_URL
    )
  );
  const verifyUrl = `${authBase}/verify-email?token=sample.token.value&callbackURL=%2Fsettings%3Fverified%3D1`;
  write("verify-email", renderVerificationEmail(verifyUrl, "sign-up", env.BETTER_AUTH_URL));
  write("change-email", renderVerificationEmail(verifyUrl, "change-email", env.BETTER_AUTH_URL));
  write(
    "invite",
    renderInviteEmail({
      inviterName: "Ada Lovelace",
      orgName: "Acme Studio",
      role: "member",
      url: `${env.BETTER_AUTH_URL}/invite/${"x".repeat(43)}`,
      expiresAt: new Date("2026-11-09T12:00:00Z"),
      instanceUrl: env.BETTER_AUTH_URL,
    })
  );
  const billing = { orgName: "Acme Studio", instanceUrl: env.BETTER_AUTH_URL };
  write(
    "billing-plan-changed",
    renderBillingEmail({ kind: "plan-changed", from: "free", to: "pro" }, billing)
  );
  write(
    "billing-payment-failed",
    renderBillingEmail(
      { kind: "payment-failed", plan: "pro", graceEndsAt: new Date("2026-11-20T00:00:00Z") },
      billing
    )
  );
  write(
    "billing-canceled",
    renderBillingEmail(
      { kind: "canceled", plan: "team", endsAt: new Date("2026-12-02T10:00:00Z") },
      billing
    )
  );
  await db.$disconnect();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
