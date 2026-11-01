import { describe, expect, it } from "vitest";

import { flashFor, LINK_ERROR_FALLBACK, strippedUrl } from "./flash";

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
