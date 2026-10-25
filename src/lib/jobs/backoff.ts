const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 60 * 60_000;

/** Delay before retry number `attempt` (1-based): 30s, 60s, 120s … capped at 1h. */
export function retryDelayMs(attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** exponent);
}
