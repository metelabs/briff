import type { PrismaClient } from "@/generated/prisma/client";
import { renderBulletinEmail } from "@/lib/email/bulletin-email";
import { sendMail, smtpConfig } from "@/lib/email/mailer";
import { orgRecipients } from "@/lib/email/recipients";
import { withOrg } from "@/lib/db/with-org";
import { bulletinJobs, writeTargetJobs } from "@/lib/delivery-targets/deliver";
import { getEnv } from "@/lib/env";
import { signFeedbackToken } from "@/lib/feedback-token";
import type { Logger } from "@/lib/log";

import { loadBulletinView } from "./bulletin-view";

export interface DeliveryCounts {
  emailsSent: number;
  emailsFailed: number;
  emailSkipped: number;
  /** Slack / webhook posts queued for this bulletin (once per target, ever). */
  targetsQueued: number;
}

/** Emails the bulletin to every org member, each with their own signed feedback links. */
export async function deliverBulletin(
  db: PrismaClient,
  orgId: string,
  bulletinId: string,
  log: Logger
): Promise<DeliveryCounts> {
  const env = getEnv();
  const counts: DeliveryCounts = {
    emailsSent: 0,
    emailsFailed: 0,
    emailSkipped: 0,
    targetsQueued: 0,
  };
  const view = await loadBulletinView(db, orgId, bulletinId);
  if (!view) throw new Error(`bulletin ${bulletinId} not found for org ${orgId}`);
  if (view.preview) throw new Error(`bulletin ${bulletinId} is a preview and is never emailed`);

  const recipients = await orgRecipients(db, orgId);
  const smtp = smtpConfig();
  const errors: string[] = [];
  if (!smtp) {
    counts.emailSkipped = recipients.length;
    log.warn({ bulletinId }, "deliver: SMTP not configured, email skipped");
  } else {
    for (const recipient of recipients) {
      const token = signFeedbackToken(env.BETTER_AUTH_SECRET, bulletinId, recipient.userId);
      const email = renderBulletinEmail(view, { baseUrl: env.BETTER_AUTH_URL, token });
      const result = await sendMail({ to: recipient.to, ...email }, smtp);
      if (result.status === "sent") counts.emailsSent++;
      else if (result.status === "failed") {
        counts.emailsFailed++;
        errors.push(result.error);
      }
    }
  }
  let jobs: Awaited<ReturnType<typeof bulletinJobs>> = [];
  try {
    jobs = await bulletinJobs(db, orgId, { id: bulletinId, streamId: view.streamId });
  } catch (err) {
    log.error({ err, bulletinId }, "deliver: could not plan Slack / webhook delivery");
  }
  // The email outcome and the target jobs are written together: a bulletin is never marked
  // sent (and so never retried) without its posts queued.
  counts.targetsQueued = await withOrg(db, orgId).$transaction(async (tx) => {
    await tx.bulletin.update({
      where: { id: bulletinId },
      data: {
        emailStatus: !smtp ? "skipped" : counts.emailsSent > 0 ? "sent" : "failed",
        emailError: errors.length > 0 ? errors.join("; ").slice(0, 1000) : null,
        emailSentAt: counts.emailsSent > 0 ? new Date() : null,
      },
    });
    return writeTargetJobs(tx, jobs);
  });
  return counts;
}
