import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { findInstanceAdmin } from "@/lib/admin";
import { sendMail } from "@/lib/email/mailer";
import {
  errorExcerpt,
  opsAlertHeadline,
  renderOpsAlertEmail,
  utcStamp,
} from "@/lib/email/ops-email";
import { getEnv } from "@/lib/env";
import type { Logger } from "@/lib/log";

export type OpsAlertKind = "failed" | "stale";

export interface OpsAlertInput {
  kind: OpsAlertKind;
  jobType: string;
  at: Date;
  error?: string | null;
  attempts?: number;
  lastSuccessAt?: Date | null;
  /** ops-check re-offering a failure that may already have been alerted: not a new failure. */
  revisit?: boolean;
}

type DeliveryResult = "sent" | "skipped" | "failed";

export type OpsAlertOutcome = "sent" | "deduped" | "skipped" | "failed";

/** At most one alert per (jobType, kind) in this window. */
export const ALERT_WINDOW_MS = 24 * 3_600_000;

export function alertDue(lastSentAt: Date | null, now: Date): boolean {
  return !lastSentAt || now.getTime() - lastSentAt.getTime() >= ALERT_WINDOW_MS;
}

interface Claim {
  id: string;
  /** The row before this claim; null when the claim created it. */
  previous: { lastSentAt: Date; suppressed: number } | null;
}

/**
 * Takes the (jobType, kind) slot for `now`, or returns null when an alert went out inside the
 * window (or another process just took it). Optimistic: the update only lands while
 * `lastSentAt` is still the value read, so two workers never both send.
 */
export async function claimOpsAlert(
  db: PrismaClient,
  alert: Pick<OpsAlertInput, "jobType" | "kind" | "revisit">,
  message: string,
  now: Date
): Promise<Claim | null> {
  const key = { jobType_kind: { jobType: alert.jobType, kind: alert.kind } };
  const existing = await db.opsAlert.findUnique({ where: key });
  if (!existing) {
    const created = await db.opsAlert.createMany({
      data: [{ jobType: alert.jobType, kind: alert.kind, lastSentAt: now, lastMessage: message }],
      skipDuplicates: true,
    });
    if (created.count === 0) return null;
    const row = await db.opsAlert.findUniqueOrThrow({ where: key, select: { id: true } });
    return { id: row.id, previous: null };
  }
  if (!alertDue(existing.lastSentAt, now)) {
    // A stale job stays stale every tick; only new failures count as held back.
    if (alert.kind === "failed" && !alert.revisit) {
      await db.opsAlert.update({ where: key, data: { suppressed: { increment: 1 } } });
    }
    return null;
  }
  const updated = await db.opsAlert.updateMany({
    where: { id: existing.id, lastSentAt: existing.lastSentAt },
    data: { lastSentAt: now, lastMessage: message, suppressed: 0 },
  });
  if (updated.count === 0) return null;
  return {
    id: existing.id,
    previous: { lastSentAt: existing.lastSentAt, suppressed: existing.suppressed },
  };
}

/** Gives the slot back after every channel failed, so the next attempt can send. */
export async function releaseOpsAlert(db: PrismaClient, claim: Claim, now: Date): Promise<void> {
  const where = { id: claim.id, lastSentAt: now };
  if (!claim.previous) await db.opsAlert.deleteMany({ where });
  else await db.opsAlert.updateMany({ where, data: claim.previous });
}

/** OPS_ALERT_EMAIL when set, else the instance admin (the first account, as on /admin). */
export async function opsAlertRecipients(db: PrismaClient): Promise<string[]> {
  const configured = getEnv().OPS_ALERT_EMAIL;
  if (configured.length > 0) return configured;
  const admin = await findInstanceAdmin(db);
  return admin ? [admin.deliveryEmail ?? admin.email] : [];
}

export interface WebhookPayload {
  /** Slack and Telegram (`sendMessage?chat_id=...`) read `text`; Discord reads `content`. */
  text: string;
  content: string;
  kind: OpsAlertKind;
  job: string;
  error: string | null;
}

export function webhookPayload(alert: OpsAlertInput, baseUrl: string): WebhookPayload {
  const error = errorExcerpt(alert.error ?? null, 2, 300);
  const when = utcStamp(alert.at);
  const text = [
    `Briff: ${opsAlertHeadline(alert)} (${when})`,
    ...(error ? [error] : []),
    `${baseUrl.replace(/\/$/, "")}/admin/runs`,
  ].join("\n");
  return { text, content: text, kind: alert.kind, job: alert.jobType, error };
}

async function postWebhook(url: string, payload: WebhookPayload): Promise<"sent" | "failed"> {
  try {
    // An operator-configured URL, not data: no safeFetch.
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    await res.body?.cancel();
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * Emails the alert to the operators and posts it to ALERT_WEBHOOK_URL, once per
 * (jobType, kind) per 24h (OpsAlert). When every channel that is configured fails, the slot is
 * released and the next failure or ops-check tick tries again; with no channel configured the
 * alert is only logged, once per window.
 */
export async function sendOpsAlert(
  db: PrismaClient,
  alert: OpsAlertInput,
  log: Logger,
  now: Date = new Date(),
  /** The calling job's heartbeat, before every send (slow SMTP must not cost the job lock). */
  heartbeat: () => Promise<void> = async () => {}
): Promise<OpsAlertOutcome> {
  const headline = opsAlertHeadline(alert);
  // Before the claim: a failing lookup must not leave a slot taken with nothing sent.
  const recipients = await opsAlertRecipients(db);
  const claim = await claimOpsAlert(db, alert, headline, now);
  if (!claim) {
    log.info({ jobType: alert.jobType, kind: alert.kind }, "ops alert: already sent within 24h");
    return "deduped";
  }
  // Filled as channels deliver: a heartbeat that throws mid-way keeps what already went out.
  const results: DeliveryResult[] = [];
  try {
    await deliver(alert, recipients, claim.previous?.suppressed ?? 0, log, heartbeat, results);
  } catch (err) {
    if (!results.includes("sent")) await releaseOpsAlert(db, claim, now);
    throw err;
  }
  if (results.includes("sent")) return "sent";
  if (results.includes("failed")) {
    await releaseOpsAlert(db, claim, now);
    return "failed";
  }
  return "skipped";
}

async function deliver(
  alert: OpsAlertInput,
  recipients: string[],
  suppressed: number,
  log: Logger,
  heartbeat: () => Promise<void>,
  results: DeliveryResult[]
): Promise<void> {
  const env = getEnv();
  const email = renderOpsAlertEmail({
    kind: alert.kind,
    jobType: alert.jobType,
    at: alert.at,
    error: alert.error ?? null,
    attempts: alert.attempts,
    lastSuccessAt: alert.lastSuccessAt ?? null,
    suppressed,
    baseUrl: env.BETTER_AUTH_URL,
  });
  // The log line is the alert of last resort (no SMTP, no webhook).
  log.warn(
    { jobType: alert.jobType, kind: alert.kind, subject: email.subject, text: email.text },
    "ops alert"
  );
  for (const to of recipients) {
    await heartbeat();
    const result = await sendMail({ to, ...email });
    if (result.status === "failed") log.error({ error: result.error }, "ops alert: email failed");
    results.push(result.status);
  }
  if (env.ALERT_WEBHOOK_URL) {
    await heartbeat();
    const result = await postWebhook(
      env.ALERT_WEBHOOK_URL,
      webhookPayload(alert, env.BETTER_AUTH_URL)
    );
    if (result === "failed") log.error({}, "ops alert: webhook failed");
    results.push(result);
  }
}
