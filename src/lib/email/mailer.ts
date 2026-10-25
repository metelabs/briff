import "server-only";

import nodemailer from "nodemailer";

import { getEnv } from "@/lib/env";

// Brevo SMTP relay (a 535 means a wrong SMTP_PASS).

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export function smtpConfig(): SmtpConfig | null {
  const env = getEnv();
  if (!env.SMTP_HOST || !env.SMTP_PORT || !env.SMTP_USER || !env.SMTP_PASS || !env.FROM_EMAIL) {
    return null;
  }
  return {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.FROM_EMAIL,
  };
}

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type MailResult =
  | { status: "sent"; messageId: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

export async function sendMail(
  message: MailMessage,
  config: SmtpConfig | null = smtpConfig()
): Promise<MailResult> {
  if (!config) return { status: "skipped", reason: "SMTP_* / FROM_EMAIL not set" };
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  try {
    const info = await transport.sendMail({
      from: { name: "Briff", address: config.from },
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    return { status: "sent", messageId: String(info.messageId) };
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message.slice(0, 500) : "unknown error",
    };
  } finally {
    transport.close();
  }
}
