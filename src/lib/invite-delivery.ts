import "server-only";

import type { OrgRole } from "@/generated/prisma/client";
import { renderInviteEmail } from "@/lib/email/invite-email";
import { sendMail } from "@/lib/email/mailer";
import { getEnv } from "@/lib/env";
import { inviteUrl } from "@/lib/invite-token";
import { log } from "@/lib/log";

export type InviteDelivery =
  /** Without SMTP the owner gets the link to pass on; it is never logged in production. */
  { status: "sent" } | { status: "no-smtp"; link: string } | { status: "failed" };

export async function deliverInvite(args: {
  orgId: string;
  inviteId?: string;
  to: string;
  token: string;
  inviterName: string;
  orgName: string;
  role: OrgRole;
  expiresAt: Date;
}): Promise<InviteDelivery> {
  const env = getEnv();
  const link = inviteUrl(env.BETTER_AUTH_URL, args.token);
  const email = renderInviteEmail({
    inviterName: args.inviterName,
    orgName: args.orgName,
    role: args.role,
    url: link,
    expiresAt: args.expiresAt,
    instanceUrl: env.BETTER_AUTH_URL,
  });
  const result = await sendMail({ to: args.to, ...email });
  if (result.status === "sent") {
    log.info({ orgId: args.orgId, inviteId: args.inviteId }, "invite: email sent");
    return { status: "sent" };
  }
  if (result.status === "skipped") {
    log.warn({ orgId: args.orgId, inviteId: args.inviteId }, "invite: email not configured");
    return { status: "no-smtp", link };
  }
  log.warn(
    { orgId: args.orgId, inviteId: args.inviteId, error: result.error },
    "invite: email failed"
  );
  return { status: "failed" };
}
