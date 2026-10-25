import "server-only";

import { getEnv } from "@/lib/env";

/**
 * The origin the public pages (landing, replays, sitemap) name as canonical: the app's own URL,
 * since briff.dev redirects to it (docs/LANDING.md). Read at request time like all env.
 */
export function publicSiteUrl(): string {
  return new URL(getEnv().BETTER_AUTH_URL).origin;
}
