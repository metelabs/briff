import type { ResetRequestState } from "../login/actions";

/**
 * Whether the page shows the "we sent a link" answer instead of the form. "Try again" stores
 * the answered state as dismissed; the next submit returns a new state object, so its own
 * result (another answer or an error) shows again.
 */
export function showsResetAnswer(
  state: ResetRequestState,
  dismissed: ResetRequestState | null
): boolean {
  return state.sent && state.message !== null && dismissed !== state;
}
