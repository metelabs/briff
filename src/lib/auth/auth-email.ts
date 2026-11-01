import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { renderPasswordResetEmail, renderVerificationEmail } from "@/lib/email/account-email";
import type { RenderedEmail } from "@/lib/email/bulletin-email";
import { sendMail } from "@/lib/email/mailer";
import { getEnv } from "@/lib/env";
import { log } from "@/lib/log";

async function deliver(
  kind: string,
  userId: string,
  to: string,
  email: RenderedEmail,
  url: string
) {
  const result = await sendMail({ to, ...email });
  if (result.status === "sent") {
    log.info({ userId, kind }, "auth: email sent");
    return;
  }
  // Without SMTP a developer still needs the link; never log it in production.
  const devLink = result.status === "skipped" && getEnv().NODE_ENV !== "production";
  log.warn({ userId, kind, result, ...(devLink ? { link: url } : {}) }, "auth: email not sent");
}

export async function sendPasswordResetEmail(user: { id: string; email: string }, url: string) {
  const email = renderPasswordResetEmail(url, getEnv().BETTER_AUTH_URL);
  await deliver("reset-password", user.id, user.email, email, url);
}

/**
 * Better Auth calls this for sign-up, resend and email change; for a change `user.email`
 * is already the new address while the stored row still has the old one.
 */
export async function sendVerificationEmailTo(
  db: PrismaClient,
  user: { id: string; email: string },
  url: string
) {
  const stored = await db.user.findUnique({ where: { id: user.id }, select: { email: true } });
  const kind = stored && stored.email !== user.email ? "change-email" : "sign-up";
  const email = renderVerificationEmail(url, kind, getEnv().BETTER_AUTH_URL);
  await deliver(`verify-${kind}`, user.id, user.email, email, url);
}
