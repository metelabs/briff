import type { ToastKind } from "./toast-kind";

export interface ActionResult {
  ok: boolean;
  message: string | null;
}

/**
 * The toast for a Server Action's state, or null. React hands back a new state object for every
 * submit, so `shown` (the last state toasted) makes a re-render silent while a new submit with
 * the same message toasts again.
 */
export function resultToast(
  state: object,
  shown: object | null,
  result: ActionResult | null
): { message: string; kind: ToastKind } | null {
  if (!result?.message || shown === state) return null;
  return { message: result.message, kind: result.ok ? "ok" : "error" };
}
