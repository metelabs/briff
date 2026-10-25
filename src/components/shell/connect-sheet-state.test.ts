import { describe, expect, it } from "vitest";

import type { ConnectData } from "@/app/onboarding/scan-status";

import { connectSheetReducer, INITIAL_CONNECT_SHEET } from "./connect-sheet-state";

const data = (secret: string | null): ConnectData => ({
  stream: { id: "s", name: "Weekly" },
  apiUrl: "https://app.briff.dev",
  status: { repos: 0, included: 0, lastScannedAt: null },
  tokens: { action: { name: "GitHub Action", prefix: "brf_abcd", secret }, local: null },
  github: { configured: false, installations: [] },
});

describe("connectSheetReducer", () => {
  it("opens empty and shows the data its load returns", () => {
    const opened = connectSheetReducer(INITIAL_CONNECT_SHEET, { type: "open" });
    expect(opened).toMatchObject({ open: true, round: 1, data: null, failed: false });
    const loaded = connectSheetReducer(opened, { type: "loaded", round: 1, data: data(null) });
    expect(loaded.data).toEqual(data(null));
  });

  it("shows the failure when the load is rejected", () => {
    const opened = connectSheetReducer(INITIAL_CONNECT_SHEET, { type: "open" });
    expect(connectSheetReducer(opened, { type: "failed", round: 1 })).toMatchObject({
      failed: true,
      data: null,
    });
  });

  it("reopens with fresh data and drops a load from an earlier opening", () => {
    let state = connectSheetReducer(INITIAL_CONNECT_SHEET, { type: "open" });
    state = connectSheetReducer(state, { type: "loaded", round: 1, data: data("brf_secret") });
    state = connectSheetReducer(state, { type: "close" });
    state = connectSheetReducer(state, { type: "open" });
    // The secret of the first opening is gone, never shown again.
    expect(state).toMatchObject({ open: true, round: 2, data: null });
    // A slow answer to the first opening must not fill the second one.
    expect(connectSheetReducer(state, { type: "loaded", round: 1, data: data("brf_secret") })).toBe(
      state
    );
    expect(connectSheetReducer(state, { type: "failed", round: 1 })).toBe(state);
    state = connectSheetReducer(state, { type: "loaded", round: 2, data: data(null) });
    expect(state.data?.tokens.action?.secret).toBeNull();
  });
});
