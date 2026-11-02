import { createHmac, randomBytes } from "node:crypto";

// Slack and webhook delivery (docs/INTEGRATIONS.md): what a target receives, pure.

export type DeliveryTargetKind = "slack" | "webhook";
export type DeliveryEventType = "bulletin" | "alerts" | "test";

export interface DeliveryItem {
  title: string;
  detail: string | null;
  url: string | null;
  severity: string | null;
  repos: string[];
}

export interface DeliveryEvent {
  type: DeliveryEventType;
  org: { id: string; name: string };
  stream: { id: string; name: string } | null;
  occurredAt: Date;
  /** Slack header and webhook `title`. */
  title: string;
  summary: string;
  /** The bulletin page or the Alerts page. */
  url: string;
  items: DeliveryItem[];
}

export const SLACK_LINES_MAX = 6;
export const SUMMARY_MAX = 600;
const HEADER_MAX = 150;

export const WEBHOOK_SECRET_PREFIX = "whsec_";

export function newWebhookSecret(): string {
  return WEBHOOK_SECRET_PREFIX + randomBytes(24).toString("base64url");
}

/** `X-Briff-Signature`: HMAC-SHA256 of the exact body bytes, hex. */
export function signBody(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** "hooks.slack.com …a1B2": the host and the last 4 characters, never the whole URL. */
export function maskUrl(raw: string): string {
  let host = "";
  try {
    host = new URL(raw).host;
  } catch {
    host = "invalid URL";
  }
  return `${host} …${raw.slice(-4)}`;
}

export type UrlCheck = { ok: true; url: string } | { ok: false; message: string };

/**
 * Syntax only; the SSRF guard runs on every send. Slack targets must be an incoming webhook
 * (`https://hooks.slack.com/services/...`), other webhooks any https URL.
 */
export function checkTargetUrl(kind: DeliveryTargetKind, raw: string): UrlCheck {
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, message: "Enter a full URL starting with https://." };
  }
  if (url.protocol !== "https:") return { ok: false, message: "The URL must start with https://." };
  if (url.username || url.password) {
    return { ok: false, message: "Remove the user name and password from the URL." };
  }
  if (value.length > 2000) return { ok: false, message: "That URL is too long." };
  if (kind === "slack") {
    if (url.hostname !== "hooks.slack.com" || !url.pathname.startsWith("/services/")) {
      return {
        ok: false,
        message: "A Slack incoming webhook URL starts with https://hooks.slack.com/services/.",
      };
    }
  }
  return { ok: true, url: url.toString() };
}

/** Slack mrkdwn treats &, < and > as control characters. */
function slackEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function itemLine(item: DeliveryItem): string {
  const sev = item.severity ? `${item.severity} · ` : "";
  const title = slackEscape(clip(item.title, 150));
  const linked = item.url ? `<${item.url}|${title}>` : title;
  const repos =
    item.repos.length > 0
      ? ` (${slackEscape(item.repos.slice(0, 3).join(", "))}${item.repos.length > 3 ? ` +${item.repos.length - 3}` : ""})`
      : "";
  const detail = item.detail ? ` — ${slackEscape(clip(item.detail, 120))}` : "";
  return `• ${sev}${linked}${repos}${detail}`;
}

function buttonLabel(type: DeliveryEventType): string {
  return type === "alerts" ? "Open alerts" : "Open bulletin";
}

type SlackBlock = Record<string, unknown>;

/** Block Kit message: header, summary, up to six bullet lines, a link button. */
export function slackPayload(event: DeliveryEvent): { text: string; blocks: SlackBlock[] } {
  const lines = event.items.slice(0, SLACK_LINES_MAX).map(itemLine);
  const more = event.items.length - lines.length;
  if (more > 0) lines.push(`…and ${more} more`);
  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: clip(event.title, HEADER_MAX), emoji: false },
    },
  ];
  if (event.summary) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: slackEscape(clip(event.summary, SUMMARY_MAX)) },
    });
  }
  if (lines.length > 0) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: lines.join("\n") } });
  }
  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: buttonLabel(event.type) },
        url: event.url,
        action_id: "briff_open",
      },
    ],
  });
  return { text: clip(event.title, HEADER_MAX), blocks };
}

export interface WebhookPayload {
  type: DeliveryEventType;
  org: { id: string; name: string };
  stream: { id: string; name: string } | null;
  occurredAt: string;
  title: string;
  summary: string;
  url: string;
  items: DeliveryItem[];
}

export function webhookPayload(event: DeliveryEvent): WebhookPayload {
  return {
    type: event.type,
    org: event.org,
    stream: event.stream,
    occurredAt: event.occurredAt.toISOString(),
    title: event.title,
    summary: clip(event.summary, SUMMARY_MAX),
    url: event.url,
    items: event.items,
  };
}

export interface OutboundRequest {
  body: string;
  headers: Record<string, string>;
}

/** The exact request a target gets: Slack's JSON, or the signed webhook JSON. */
export function buildRequest(
  target: { kind: DeliveryTargetKind; secret: string | null },
  event: DeliveryEvent,
  deliveryId: string
): OutboundRequest {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "User-Agent": "Briff-Delivery/1",
  };
  if (target.kind === "slack") {
    return { body: JSON.stringify(slackPayload(event)), headers };
  }
  const body = JSON.stringify(webhookPayload(event));
  headers["X-Briff-Event"] = event.type;
  headers["X-Briff-Delivery"] = deliveryId;
  if (target.secret) headers["X-Briff-Signature"] = signBody(body, target.secret);
  return { body, headers };
}

/** A sample message for "Send test": the same shape as a real one. */
export function testEvent(args: {
  org: { id: string; name: string };
  stream: { id: string; name: string } | null;
  baseUrl: string;
  now: Date;
}): DeliveryEvent {
  return {
    type: "test",
    org: args.org,
    stream: args.stream,
    occurredAt: args.now,
    title: `Briff · test message for ${args.org.name}`,
    summary:
      "This is a test from Briff. Weekly bulletins and same-day security alerts will arrive here.",
    url: `${args.baseUrl}/settings#integrations`,
    items: [
      {
        title: "example-package 1.2.3 security release",
        detail: "Sample line: update example-package to 1.2.3.",
        url: null,
        severity: "HIGH",
        repos: ["example/app"],
      },
    ],
  };
}
