import type { Instrumentation } from "next";

// Server-side Sentry for the web app, only when SENTRY_DSN is set (src/lib/sentry.ts).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { initSentry } = await import("@/lib/sentry");
  await initSentry("web");
}

export const onRequestError: Instrumentation.onRequestError = async (err, _request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { captureException } = await import("@/lib/sentry");
  await captureException(err, { routePath: context.routePath, routeType: context.routeType });
};
