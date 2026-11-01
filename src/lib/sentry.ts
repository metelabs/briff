import "server-only";

import { getEnv } from "@/lib/env";
import { log } from "@/lib/log";

// Optional error reporting. Without SENTRY_DSN, @sentry/node is never imported. Server side
// only (worker and the web server's instrumentation hook): no client bundle, no PII, no tracing.

type Sentry = typeof import("@sentry/node");

let loading: Promise<Sentry | null> | null = null;

export function initSentry(role: "web" | "worker"): Promise<Sentry | null> {
  if (loading) return loading;
  let dsn: string | undefined;
  let environment: string;
  try {
    const env = getEnv();
    dsn = env.SENTRY_DSN;
    environment = env.NODE_ENV;
  } catch {
    // Invalid configuration surfaces elsewhere (worker start, /api/health warnings).
    return (loading = Promise.resolve(null));
  }
  if (!dsn) return (loading = Promise.resolve(null));
  loading = import("@sentry/node")
    .then((sentry) => {
      sentry.init({
        dsn,
        environment,
        tracesSampleRate: 0,
        includeServerName: false,
        // Sentry 11's replacement for `sendDefaultPii: false`: collect no user, request,
        // query or local-variable data at all.
        dataCollection: {
          userInfo: false,
          cookies: false,
          httpHeaders: false,
          httpBodies: [],
          urlQueryParams: false,
          graphQL: { document: false, variables: false },
          genAI: { inputs: false, outputs: false },
          mcp: { inputs: false, outputs: false },
          databaseQueryData: false,
          stackFrameVariables: false,
        },
        initialScope: { tags: { role } },
      });
      return sentry;
    })
    .catch((err: unknown) => {
      log.error({ err }, "sentry: init failed");
      return null;
    });
  return loading;
}

/** Reports an error when Sentry was initialised; a no-op otherwise. Never throws. */
export async function captureException(
  err: unknown,
  tags: Record<string, string | number> = {}
): Promise<void> {
  try {
    const sentry = await (loading ?? Promise.resolve(null));
    sentry?.captureException(err, { tags });
  } catch {
    // Reporting must never break the caller.
  }
}

/** Waits for queued events before the process exits (the worker's --once mode, shutdown). */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  const sentry = await (loading ?? Promise.resolve(null));
  await sentry?.flush(timeoutMs);
}
