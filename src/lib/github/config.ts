import "server-only";

import { getEnv } from "@/lib/env";

export interface GithubAppConfig {
  appId: string;
  slug: string;
  privateKey: string;
  webhookSecret: string;
  clientId: string;
  clientSecret: string;
}

/**
 * The PEM as given: a literal key (newlines possibly escaped as `\n`, the usual way to put
 * a multi-line value into one env line) or the whole file base64-encoded.
 */
export function parsePrivateKey(raw: string): string {
  const text = raw.trim();
  if (text.includes("-----BEGIN")) return text.replace(/\\n/g, "\n");
  const decoded = Buffer.from(text, "base64").toString("utf8").trim();
  if (!decoded.includes("-----BEGIN")) {
    throw new Error("GITHUB_APP_PRIVATE_KEY is neither a PEM nor a base64-encoded PEM");
  }
  return decoded;
}

/** The app's configuration, or null while any of its variables is missing. */
export function githubAppConfig(): GithubAppConfig | null {
  const env = getEnv();
  if (
    !env.GITHUB_APP_ID ||
    !env.GITHUB_APP_SLUG ||
    !env.GITHUB_APP_PRIVATE_KEY ||
    !env.GITHUB_APP_WEBHOOK_SECRET ||
    !env.GITHUB_APP_CLIENT_ID ||
    !env.GITHUB_APP_CLIENT_SECRET
  ) {
    return null;
  }
  return {
    appId: env.GITHUB_APP_ID,
    slug: env.GITHUB_APP_SLUG,
    privateKey: parsePrivateKey(env.GITHUB_APP_PRIVATE_KEY),
    webhookSecret: env.GITHUB_APP_WEBHOOK_SECRET,
    clientId: env.GITHUB_APP_CLIENT_ID,
    clientSecret: env.GITHUB_APP_CLIENT_SECRET,
  };
}
