import "server-only";

import { getEnv } from "@/lib/env";
import { log } from "@/lib/log";

/** How long /status waits for the health check before calling the service down. */
const HEALTH_TIMEOUT_MS = 5000;

/**
 * The full /api/health answer, read from this same server over loopback: the status page is
 * public and may not import the database client (src/test/public-routes.test.ts), the route
 * may. Null when the request fails or times out. 503 bodies are returned like 200 ones.
 */
export async function fetchHealth(): Promise<unknown> {
  const url = `http://127.0.0.1:${getEnv().PORT}/api/health`;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return (await res.json()) as unknown;
  } catch (err) {
    log.warn({ err }, "status: health check failed");
    return null;
  }
}
