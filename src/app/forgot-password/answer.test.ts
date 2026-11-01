import { describe, expect, it } from "vitest";

import type { ResetRequestState } from "../login/actions";
import { showsResetAnswer } from "./answer";

const SENT = "If an account exists for that address, we sent a link to reset its password.";

describe("showsResetAnswer", () => {
  it("shows the form before any submit", () => {
    expect(showsResetAnswer({ sent: false, message: null }, null)).toBe(false);
  });

  it("keeps the form for an error", () => {
    expect(showsResetAnswer({ sent: false, message: "Enter a valid email address." }, null)).toBe(
      false
    );
  });

  it("replaces the form with the answer after a successful request", () => {
    expect(showsResetAnswer({ sent: true, message: SENT }, null)).toBe(true);
  });

  it("success, try again, success: the form comes back, then the new answer shows", () => {
    const first: ResetRequestState = { sent: true, message: SENT };
    expect(showsResetAnswer(first, first)).toBe(false);
    const second: ResetRequestState = { sent: true, message: SENT };
    expect(showsResetAnswer(second, first)).toBe(true);
  });

  it("success, try again, error: the form stays with the error", () => {
    const first: ResetRequestState = { sent: true, message: SENT };
    const error: ResetRequestState = {
      sent: false,
      message: "Too many attempts. Try again in one hour.",
    };
    expect(showsResetAnswer(error, first)).toBe(false);
  });
});
