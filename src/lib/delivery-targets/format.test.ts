import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildRequest,
  checkTargetUrl,
  maskUrl,
  newWebhookSecret,
  signBody,
  slackPayload,
  type DeliveryEvent,
} from "./format";

const event = (items: number): DeliveryEvent => ({
  type: "alerts",
  org: { id: "org1", name: "Acme" },
  stream: null,
  occurredAt: new Date("2026-11-03T04:00:00Z"),
  title: "Briff · 2 new security advisories",
  summary: "2 critical or high advisories affect <3> repos & more.",
  url: "https://briff.example.com/alerts",
  items: Array.from({ length: items }, (_, i) => ({
    title: `pkg-${i}: GHSA-${i}`,
    detail: "Prototype pollution",
    url: `https://osv.dev/vulnerability/GHSA-${i}`,
    severity: "HIGH",
    repos: ["a/one", "a/two", "a/three", "a/four"],
  })),
});

describe("delivery target format", () => {
  it("shows only the host and the last four characters of a URL", () => {
    expect(maskUrl("https://hooks.slack.com/services/T000/B000/abcdWXYZ")).toBe(
      "hooks.slack.com …WXYZ"
    );
  });

  it("accepts Slack incoming webhooks and https webhooks only", () => {
    expect(checkTargetUrl("slack", " https://hooks.slack.com/services/T/B/x ").ok).toBe(true);
    expect(checkTargetUrl("slack", "https://hooks.slack.com/workflows/x").ok).toBe(false);
    expect(checkTargetUrl("slack", "https://evil.example/services/x").ok).toBe(false);
    expect(checkTargetUrl("webhook", "https://example.com/hook").ok).toBe(true);
    expect(checkTargetUrl("webhook", "http://example.com/hook").ok).toBe(false);
    expect(checkTargetUrl("webhook", "https://user:pw@example.com/hook").ok).toBe(false);
    expect(checkTargetUrl("webhook", "not a url").ok).toBe(false);
  });

  it("builds a Block Kit message with at most six lines, escaped, and a link button", () => {
    const msg = slackPayload(event(8));
    expect(msg.blocks.map((b) => b.type)).toEqual(["header", "section", "section", "actions"]);
    const summary = (msg.blocks[1] as { text: { text: string } }).text.text;
    expect(summary).toBe("2 critical or high advisories affect &lt;3&gt; repos &amp; more.");
    const lines = (msg.blocks[2] as { text: { text: string } }).text.text.split("\n");
    expect(lines).toHaveLength(7);
    expect(lines[0]).toBe(
      "• HIGH · <https://osv.dev/vulnerability/GHSA-0|pkg-0: GHSA-0> (a/one, a/two, a/three +1) — Prototype pollution"
    );
    expect(lines[6]).toBe("…and 2 more");
    expect(msg.blocks[3]).toMatchObject({
      elements: [{ type: "button", url: "https://briff.example.com/alerts" }],
    });
  });

  it("signs the exact webhook body with HMAC-SHA256 and names the event and delivery", () => {
    const req = buildRequest({ kind: "webhook", secret: "whsec_k" }, event(1), "job-1");
    const expected = createHmac("sha256", "whsec_k").update(req.body).digest("hex");
    expect(req.headers["X-Briff-Signature"]).toBe(`sha256=${expected}`);
    expect(req.headers["X-Briff-Event"]).toBe("alerts");
    expect(req.headers["X-Briff-Delivery"]).toBe("job-1");
    expect(JSON.parse(req.body)).toMatchObject({
      type: "alerts",
      org: { id: "org1", name: "Acme" },
      stream: null,
      occurredAt: "2026-11-03T04:00:00.000Z",
      url: "https://briff.example.com/alerts",
      items: [{ title: "pkg-0: GHSA-0", severity: "HIGH" }],
    });
    expect(signBody(req.body, "other")).not.toBe(req.headers["X-Briff-Signature"]);
    const slack = buildRequest({ kind: "slack", secret: null }, event(1), "job-1");
    expect(slack.headers["X-Briff-Signature"]).toBeUndefined();
  });

  it("generates distinct signing secrets", () => {
    const a = newWebhookSecret();
    expect(a).toMatch(/^whsec_[A-Za-z0-9_-]{32}$/);
    expect(newWebhookSecret()).not.toBe(a);
  });
});
