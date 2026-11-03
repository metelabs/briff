import { describe, expect, it } from "vitest";

import { renderOpsAlertEmail } from "./ops-email";

describe("renderOpsAlertEmail", () => {
  const base = {
    jobType: "security-scan",
    at: new Date("2026-11-02T04:01:00Z"),
    lastSuccessAt: new Date("2026-11-01T04:02:00Z"),
    suppressed: 0,
    baseUrl: "https://briff.example.com/",
  };

  it("names the job, the time, the error excerpt and links to Admin → Runs", () => {
    const email = renderOpsAlertEmail({
      ...base,
      kind: "failed",
      attempts: 5,
      error: "Error: OSV <503>\n at a\n at b\n at c\n at d\n at e",
    });
    expect(email.subject).toBe("Briff · Job failed: security-scan");
    expect(email.html).toContain("Job failed: security-scan");
    expect(email.html).toContain("2026-11-02 04:01 UTC");
    expect(email.html).toContain("Error: OSV &lt;503&gt;");
    expect(email.html).not.toContain(" at e");
    expect(email.html).toContain('href="https://briff.example.com/admin/runs"');
    expect(email.text).toContain("after 5 attempts");
    expect(email.text).toContain("Runs: https://briff.example.com/admin/runs");
  });

  it("explains a stale job and counts held-back alerts", () => {
    const email = renderOpsAlertEmail({ ...base, kind: "stale", error: null, suppressed: 2 });
    expect(email.subject).toBe("Briff · Job overdue: security-scan");
    expect(email.text).toContain("No successful run since 2026-11-01 04:02 UTC");
    expect(email.text).toContain("2 more alerts of this kind were held back");
    expect(email.html).not.toContain("ERROR");
  });

  it("words a budget alert as a notice and links to the organisation table", () => {
    const email = renderOpsAlertEmail({
      ...base,
      kind: "budget",
      jobType: "llm-budget:org1:2026-11:80",
      error: null,
      lastSuccessAt: null,
      headline: "LLM budget 80%: Acme",
      summary: "The organisation has used an estimated $2.40 of its $3.00 monthly LLM budget.",
    });
    expect(email.subject).toBe("Briff · LLM budget 80%: Acme");
    expect(email.html).toContain('href="https://briff.example.com/admin#organisations"');
    expect(email.text).toContain("Reached at: 2026-11-02 04:01 UTC");
    expect(email.text).not.toContain("Last success");
    expect(email.text).toContain("Admin: https://briff.example.com/admin#organisations");
  });
});
