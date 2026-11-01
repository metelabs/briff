import { describe, expect, it } from "vitest";

import { resultToast } from "./toast-result";

describe("resultToast", () => {
  it("is silent for the initial empty state", () => {
    const initial = { ok: true, message: null };
    expect(resultToast(initial, null, initial)).toBeNull();
  });

  it("toasts a result once, and not again when the same state re-renders", () => {
    const state = { ok: true, message: "Saved." };
    expect(resultToast(state, null, state)).toEqual({ message: "Saved.", kind: "ok" });
    expect(resultToast(state, state, state)).toBeNull();
  });

  it("toasts again for a new submit with the same message", () => {
    const first = { ok: false, message: "The current password is wrong." };
    const second = { ok: false, message: "The current password is wrong." };
    expect(resultToast(second, first, second)).toEqual({
      message: "The current password is wrong.",
      kind: "error",
    });
  });

  it("maps failures to the error kind", () => {
    const state = { error: "Invalid email or password." };
    expect(resultToast(state, null, { ok: false, message: state.error })?.kind).toBe("error");
  });
});
