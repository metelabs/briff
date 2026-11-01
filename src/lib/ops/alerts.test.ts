import { describe, expect, it } from "vitest";

import { ALERT_WINDOW_MS, alertDue, webhookPayload } from "./alerts";

describe("alert dedupe window", () => {
  const now = new Date("2026-11-02T12:00:00Z");

  it("sends the first alert and the next one only after 24h", () => {
    expect(alertDue(null, now)).toBe(true);
    expect(alertDue(new Date(now.getTime() - ALERT_WINDOW_MS + 1000), now)).toBe(false);
    expect(alertDue(new Date(now.getTime() - ALERT_WINDOW_MS), now)).toBe(true);
  });
});

describe("webhookPayload", () => {
  it("carries a chat-ready text, the job and an error excerpt", () => {
    const payload = webhookPayload(
      {
        kind: "failed",
        jobType: "security-scan",
        at: new Date("2026-11-02T04:01:00Z"),
        error: "Error: OSV 503\n    at query (osv.ts:1)\n    at more (x.ts:2)",
      },
      "https://briff.example.com/"
    );
    expect(payload).toEqual({
      text: "Briff: Job failed: security-scan (2026-11-02 04:01 UTC)\nError: OSV 503\n    at query (osv.ts:1)\nhttps://briff.example.com/admin/runs",
      content: payload.text,
      kind: "failed",
      job: "security-scan",
      error: "Error: OSV 503\n    at query (osv.ts:1)",
    });
  });
});
