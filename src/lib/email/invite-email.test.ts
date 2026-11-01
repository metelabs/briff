import { describe, expect, it } from "vitest";

import { renderInviteEmail } from "./invite-email";

const URL = "https://app.example.com/invite/abc_DEF-123";
const BASE = {
  inviterName: "Ada Lovelace",
  orgName: "Acme Studio",
  role: "member" as const,
  url: URL,
  expiresAt: new Date("2026-11-08T12:00:00Z"),
  instanceUrl: "https://app.example.com",
};

describe("invite email", () => {
  it("names the inviter and the org, links the invite and states the expiry", () => {
    const email = renderInviteEmail(BASE);
    expect(email.subject).toBe("Ada Lovelace invited you to Acme Studio on Briff");
    expect(email.html).toContain('src="https://app.example.com/brand/lockup-email-tile.png"');
    expect(email.html).toContain(`href="${URL}"`);
    expect(email.html).toContain("Accept invite");
    expect(email.html).toContain("expires on 8 November 2026");
    expect(email.text).toContain(`Accept invite: ${URL}`);
    expect(email.html).toContain("copy this link into your browser");
  });

  it("escapes names and keeps them on one subject line", () => {
    const email = renderInviteEmail({
      ...BASE,
      inviterName: "Eve\r\nBcc: x@example.com",
      orgName: "<script>alert(1)</script>",
    });
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.subject).toBe(
      "Eve Bcc: x@example.com invited you to <script>alert(1)</script> on Briff"
    );
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });

  it("tells an invited owner they can manage members", () => {
    expect(renderInviteEmail({ ...BASE, role: "owner" }).text).toContain("manage its members");
  });
});
