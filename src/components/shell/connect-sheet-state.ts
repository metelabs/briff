import type { ConnectData } from "@/app/onboarding/scan-status";

// State of the Connect repos sheet, pure so loading, failure and reopening are testable.
// Every opening is a new round: its data loads afresh (new tokens and status, so a token's
// secret is never shown twice), and a load that answers after a newer opening is dropped.

export interface ConnectSheetState {
  open: boolean;
  round: number;
  data: ConnectData | null;
  failed: boolean;
}

export type ConnectSheetEvent =
  | { type: "open" }
  | { type: "close" }
  | { type: "loaded"; round: number; data: ConnectData }
  | { type: "failed"; round: number };

export const INITIAL_CONNECT_SHEET: ConnectSheetState = {
  open: false,
  round: 0,
  data: null,
  failed: false,
};

export function connectSheetReducer(
  state: ConnectSheetState,
  event: ConnectSheetEvent
): ConnectSheetState {
  switch (event.type) {
    case "open":
      return { open: true, round: state.round + 1, data: null, failed: false };
    case "close":
      return { ...state, open: false };
    case "loaded":
      return event.round === state.round ? { ...state, data: event.data, failed: false } : state;
    case "failed":
      return event.round === state.round && state.data === null
        ? { ...state, failed: true }
        : state;
  }
}
