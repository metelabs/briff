import { describe, expect, it } from "vitest";

import { DEFAULT_INVITE_ROLE, roleAfterInvite } from "./invite-role";

describe("roleAfterInvite", () => {
  it("starts at Member and goes back to Member after a sent Owner invite", () => {
    expect(DEFAULT_INVITE_ROLE).toBe("member");
    expect(roleAfterInvite("owner", { ok: true })).toBe("member");
    expect(roleAfterInvite("member", { ok: true })).toBe("member");
  });

  it("keeps the chosen role when the send failed", () => {
    expect(roleAfterInvite("owner", { ok: false })).toBe("owner");
    expect(roleAfterInvite("member", { ok: false })).toBe("member");
  });
});
