import type { ZodType } from "zod";

export interface FetchWithRetryOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  retryBaseDelayMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 200;

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * fetch() with timeout (AbortController) and exponential-backoff retry on
 * network errors and 5xx/429 responses. 4xx responses are returned as-is so
 * the caller can decide; do NOT throw on non-2xx (preserves existing call
 * sites that check res.ok).
 */
export async function fetchWithRetry(
  input: string | URL,
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
    signal: externalSignal,
    ...init
  } = options;

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const onAbort = () => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener("abort", onAbort, { once: true });

    try {
      const res = await fetch(input, { ...init, signal: controller.signal });
      if (!isRetryableStatus(res.status) || attempt === retries) {
        return res;
      }
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
      if (externalSignal?.aborted) throw err;
      if (attempt === retries) throw err;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onAbort);
    }

    await new Promise((r) => setTimeout(r, retryBaseDelayMs * 2 ** attempt));
  }

  throw lastError ?? new Error("fetchWithRetry: exhausted retries");
}

/**
 * fetchWithRetry + JSON parse + Zod safeParse, all in one. Throws on non-OK
 * status or parse failure with a label that identifies the source — callers
 * can wrap in try/catch (or Promise.allSettled) when they want graceful
 * degradation. Standard pattern for all platform fetchers.
 */
export async function fetchJson<T>(
  label: string,
  input: string | URL,
  schema: ZodType<T>,
  options: FetchWithRetryOptions = {}
): Promise<T> {
  const res = await fetchWithRetry(input, options);
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);

  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) throw new Error(`${label}: invalid response shape`);
  return parsed.data;
}
