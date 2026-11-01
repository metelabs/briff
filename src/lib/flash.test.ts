import { describe, expect, it } from "vitest";

import {
  flashFor,
  flashStep,
  LINK_ERROR_FALLBACK,
  membershipFlashQuery,
  strippedUrl,
} from "./flash";

const q = (s: string) => new URLSearchParams(s);

describe("flashFor", () => {
  it("verified email on /settings", () => {
    expect(flashFor("/settings", q("verified=1"))).toEqual({
      kind: "ok",
      message: "Your email address is verified.",
      strip: ["verified", "error"],
    });
  });

  it("a change-email link opened twice is an error only, never the success too", () => {
    const flash = flashFor("/settings", q("verified=1&error=USER_NOT_FOUND"));
    expect(flash?.kind).toBe("error");
    expect(flash?.message).toMatch(/already used/);
    expect(flash?.strip).toEqual(["verified", "error"]);
  });

  it("expired and unknown link errors", () => {
    expect(flashFor("/settings", q("verified=1&error=TOKEN_EXPIRED"))?.message).toMatch(/expired/);
    expect(flashFor("/settings", q("verified=1&error=SOMETHING_NEW"))).toMatchObject({
      kind: "error",
      message: LINK_ERROR_FALLBACK,
    });
  });

  it("password changed and login notices", () => {
    expect(flashFor("/settings", q("password=changed"))?.kind).toBe("ok");
    expect(flashFor("/login", q("reset=1"))?.message).toBe(
      "Your password was changed. Sign in with the new one."
    );
    expect(flashFor("/login", q("deleted=1"))?.strip).toEqual(["deleted"]);
  });

  it("joining or leaving an org, on Home or onboarding", () => {
    expect(flashFor("/", q("joined=1"))?.message).toContain("You joined the organisation.");
    expect(flashFor("/onboarding", q("joined=1"))?.kind).toBe("ok");
    expect(flashFor("/", q("left=1"))?.message).toBe("You left the organisation.");
    expect(flashFor("/settings", q("joined=1"))).toBeNull();
    expect(membershipFlashQuery({ joined: "1" })).toBe("?joined=1");
    expect(membershipFlashQuery({ left: "1" })).toBe("?left=1");
    expect(membershipFlashQuery({ joined: ["1", "1"] })).toBe("");
  });

  it("ignores other pages, values and params", () => {
    expect(flashFor("/alerts", q("verified=1"))).toBeNull();
    expect(flashFor("/settings", q("verified=0"))).toBeNull();
    expect(flashFor("/login", q("mode=sign-up"))).toBeNull();
  });
});

describe("strippedUrl", () => {
  it("removes only the flash params and keeps the hash", () => {
    expect(strippedUrl("/settings", q("password=changed&tab=x"), ["password"], "#account")).toBe(
      "/settings?tab=x#account"
    );
    expect(strippedUrl("/login", q("reset=1"), ["reset"])).toBe("/login");
  });
});

describe("flashStep", () => {
  it("toasts once per URL and again after the params were stripped", () => {
    const changed = q("password=changed");
    const first = flashStep("/settings", changed, null);
    expect(first.show?.message).toMatch(/Password changed/);
    expect(flashStep("/settings", changed, first.key).show).toBeNull();
    const stripped = flashStep("/settings", q(""), first.key);
    expect(stripped).toEqual({ show: null, key: null });
    expect(flashStep("/settings", changed, stripped.key).show).not.toBeNull();
  });
});
