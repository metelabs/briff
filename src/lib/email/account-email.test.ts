import { describe, expect, it } from "vitest";

import { renderPasswordResetEmail, renderVerificationEmail } from "./account-email";

const RESET =
  "https://app.example.com/api/auth/reset-password/tok123?callbackURL=%2Freset-password";
const VERIFY = "https://app.example.com/api/auth/verify-email?token=a.b.c&callbackURL=%2Fsettings";

describe("account emails", () => {
  it("renders the reset link in the Triage shell with a one-hour note", () => {
    const email = renderPasswordResetEmail(RESET, "https://app.example.com");
    expect(email.subject).toBe("Briff · reset your password");
    expect(email.html).toContain('src="https://app.example.com/brand/lockup-email-tile.png"');
    expect(email.html).toContain(`href="${RESET.replace(/&/g, "&amp;")}"`);
    expect(email.html).toContain("expires in one hour");
    expect(email.text).toContain(`Choose a new password: ${RESET}`);
    expect(email.html).toContain('height="44"');
    expect(email.html).toContain("Sent by the Briff instance at https://app.example.com.");
  });

  it("words sign-up verification and email change differently", () => {
    const signUp = renderVerificationEmail(VERIFY, "sign-up");
    const change = renderVerificationEmail(VERIFY, "change-email");
    expect(signUp.subject).toBe("Briff · verify your email address");
    expect(change.subject).toBe("Briff · confirm your new email address");
    expect(signUp.html).toContain("token=a.b.c&amp;callbackURL=%2Fsettings");
    expect(change.text).toContain(`Confirm new address: ${VERIFY}`);
  });

  it("keeps the button readable in dark mode and the body at 16px on phones", () => {
    const { html } = renderVerificationEmail(VERIFY, "sign-up");
    expect(html).toContain(".b-btn{background:#3ccfc2 !important;color:#04201e !important}");
    expect(html).toContain(".m-body{font-size:16px !important");
    expect(html).toContain('class="b-btn"');
  });

  it("never links a non-http URL", () => {
    const email = renderPasswordResetEmail("javascript:alert(1)");
    expect(email.html).not.toContain("javascript:");
    expect(email.text).toContain("Choose a new password: #");
  });
});
