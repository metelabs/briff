import { caps } from "@/lib/i18n";

import type { RenderedEmail } from "./bulletin-email";
import { C, DISPLAY, emailShell, esc, FONT, MONO, tag } from "./layout";

// Operator alert for the instance admin (src/lib/ops/alerts.ts). English only: it goes to
// whoever runs the instance, not to members. One column at every width with 16px body text,
// so the phone layout needs no media query of its own.

export interface OpsAlertEmail {
  kind: "failed" | "stale";
  jobType: string;
  /** When it failed, or when the job became stale. */
  at: Date;
  error: string | null;
  attempts?: number;
  lastSuccessAt: Date | null;
  /** Alerts of the same job and kind held back by the 24h window since the previous email. */
  suppressed: number;
  baseUrl: string;
}

export function utcStamp(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** First lines of an error (a stack trace's message and top frames), capped. */
export function errorExcerpt(error: string | null, lines = 4, chars = 600): string | null {
  if (!error) return null;
  const text = error.split("\n").slice(0, lines).join("\n").trim();
  return text.length > chars ? `${text.slice(0, chars - 1)}…` : text;
}

export function opsAlertHeadline(alert: Pick<OpsAlertEmail, "kind" | "jobType">): string {
  return alert.kind === "failed" ? `Job failed: ${alert.jobType}` : `Job overdue: ${alert.jobType}`;
}

function lead(alert: OpsAlertEmail): string {
  if (alert.kind === "failed") {
    const tries = alert.attempts
      ? ` after ${alert.attempts} ${alert.attempts === 1 ? "attempt" : "attempts"}`
      : "";
    return `The worker gave up on this job${tries}. It runs again at its next scheduled time.`;
  }
  return alert.lastSuccessAt
    ? `No successful run since ${utcStamp(alert.lastSuccessAt)}, longer than its schedule allows.`
    : "It was queued but has never succeeded. Check that the worker is running.";
}

const LABEL_STYLE = `font-family:${FONT};font-size:12px;line-height:1.4;font-weight:600;letter-spacing:.06em;color:${C.muted};padding:12px 0 2px;`;
const VALUE_STYLE = `font-family:${FONT};font-size:16px;line-height:1.5;color:${C.text};padding:0 0 12px;border-bottom:1px solid ${C.border};word-break:break-word;`;

function detailRow(label: string, valueHtml: string, last = false): string {
  const value = last ? VALUE_STYLE.replace(/border-bottom:[^;]+;/, "") : VALUE_STYLE;
  return `<tr><td class="b-muted" style="${LABEL_STYLE}">${esc(caps(label))}</td></tr>
<tr><td class="b-text b-line" style="${value}">${valueHtml}</td></tr>`;
}

function button(href: string, text: string): string {
  // Petrol in both schemes; white on #0b6b67 is 6.3:1.
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 4px;"><tr><td bgcolor="${C.brand}" style="background:${C.brand};border-radius:10px;">
<a href="${esc(href)}" style="display:inline-block;padding:12px 20px;font-family:${FONT};font-size:16px;line-height:1.2;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${esc(text)} &rarr;</a>
</td></tr></table>`;
}

export function renderOpsAlertEmail(alert: OpsAlertEmail): RenderedEmail {
  const headline = opsAlertHeadline(alert);
  const base = alert.baseUrl.replace(/\/$/, "");
  const runsUrl = `${base}/admin/runs`;
  const excerpt = errorExcerpt(alert.error);
  const rows: string[] = [
    detailRow(
      "Job",
      `<span style="font-family:${MONO};font-size:15px;">${esc(alert.jobType)}</span>`
    ),
    detailRow(alert.kind === "failed" ? "Failed at" : "Overdue since", esc(utcStamp(alert.at))),
    detailRow("Last success", esc(alert.lastSuccessAt ? utcStamp(alert.lastSuccessAt) : "never")),
  ];
  if (excerpt) {
    rows.push(`<tr><td class="b-muted" style="${LABEL_STYLE}">${esc(caps("Error"))}</td></tr>
<tr><td style="padding:2px 0 12px;border-bottom:1px solid ${C.border};" class="b-line"><div class="b-inset b-text" style="background:${C.inset};border:1px solid ${C.border};border-radius:10px;padding:10px 12px;font-family:${MONO};font-size:13px;line-height:1.5;color:${C.text};white-space:pre-wrap;word-break:break-word;">${esc(excerpt)}</div></td></tr>`);
  }
  rows.push(
    detailRow(
      "Instance",
      `<a class="b-link" href="${esc(base)}" style="color:${C.link};text-decoration:none;">${esc(base)}</a>`,
      true
    )
  );
  const suppressedLine =
    alert.suppressed > 0
      ? `<p class="b-muted" style="font-family:${FONT};font-size:14px;line-height:1.5;color:${C.muted};margin:14px 0 0;">${alert.suppressed} more ${alert.suppressed === 1 ? "alert" : "alerts"} of this kind were held back since the previous email.</p>`
      : "";
  const footer =
    "You get this because you administer this Briff instance (or OPS_ALERT_EMAIL names you). At most one email per job and problem every 24 hours.";

  const body = `${tag(alert.kind === "failed" ? "Failed" : "Overdue", "upgrade")}
<h1 class="b-text" style="font-family:${DISPLAY};font-size:24px;line-height:1.2;font-weight:600;letter-spacing:-0.02em;color:${C.text};margin:12px 0 8px;">${esc(headline)}</h1>
<p class="b-text" style="font-family:${FONT};font-size:16px;line-height:1.5;color:${C.text};margin:0 0 8px;">${esc(lead(alert))}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="m-fixed" style="margin:6px 0 0;">
${rows.join("\n")}
</table>
${button(runsUrl, "Open runs in Admin")}
${suppressedLine}`;

  const text = [
    headline,
    "",
    lead(alert),
    "",
    `Job: ${alert.jobType}`,
    `${alert.kind === "failed" ? "Failed at" : "Overdue since"}: ${utcStamp(alert.at)}`,
    `Last success: ${alert.lastSuccessAt ? utcStamp(alert.lastSuccessAt) : "never"}`,
    ...(excerpt ? ["", "Error:", excerpt] : []),
    "",
    `Instance: ${base}`,
    `Runs: ${runsUrl}`,
    ...(alert.suppressed > 0
      ? [
          "",
          `${alert.suppressed} more alerts of this kind were held back since the previous email.`,
        ]
      : []),
    "",
    "--",
    footer,
  ].join("\n");

  return {
    subject: `Briff · ${headline}`,
    html: emailShell({
      language: "en",
      title: headline,
      footer,
      assetBaseUrl: base,
      body,
    }),
    text,
  };
}
