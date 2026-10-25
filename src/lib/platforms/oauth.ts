import "server-only";

import { fetchWithRetry } from "./fetch-with-retry";

// Briff has no Redis: tokens are cached in process memory, which is enough for
// one worker process (a restart costs one extra token request).
const tokenCache = new Map<string, CachedToken>();

function getCached(key: string): CachedToken | null {
  return tokenCache.get(key) ?? null;
}

function setCache(key: string, value: CachedToken): void {
  tokenCache.set(key, value);
}

/**
 * Generic OAuth2 client-credentials token resolver, cached so we don't
 * hit the auth endpoint on every platform fetch. Each provider gets its own
 * cache namespace and slightly different request shape (form-encoded vs JSON,
 * Basic auth vs body credentials), so the caller hands us the recipe.
 */
interface OAuthTokenRecipe {
  /** Cache namespace; pair with clientId for uniqueness. */
  provider: string;
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  /** "basic" → Authorization: Basic base64(id:secret) + body has grant_type only.
   *  "body" → no auth header; id+secret go in the JSON/form body. */
  authStyle: "basic" | "body";
  /** "json" → application/json body. "form" → application/x-www-form-urlencoded. */
  bodyStyle: "json" | "form";
  /** Optional extra body fields (e.g., `scope`). */
  extra?: Record<string, string>;
  /** Optional User-Agent the provider requires (Reddit demands a descriptive UA). */
  userAgent?: string;
  /**
   * Fallback lifetime when the token endpoint doesn't return `expires_in`.
   * Product Hunt, for example, omits it entirely — their tokens are
   * effectively long-lived. Cache for 24h by default in that case.
   */
  fallbackTtlSeconds?: number;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number; // UNIX ms
}

// Don't cache right up to the wire — give ourselves a 60s safety margin in case
// upstream and our clock are slightly skewed, or the request itself takes a beat.
const EXPIRY_SAFETY_MS = 60_000;

function cacheKey(provider: string, clientId: string): string {
  return `oauth:${provider}:${clientId.slice(0, 12)}`;
}

export async function getOAuthToken(recipe: OAuthTokenRecipe): Promise<string | null> {
  const key = cacheKey(recipe.provider, recipe.clientId);

  const cached = getCached(key);
  if (cached && cached.expiresAt > Date.now() + EXPIRY_SAFETY_MS) {
    return cached.accessToken;
  }

  const headers: Record<string, string> = {};
  if (recipe.userAgent) headers["User-Agent"] = recipe.userAgent;

  let body: string;
  if (recipe.bodyStyle === "form") {
    const params = new URLSearchParams();
    params.set("grant_type", "client_credentials");
    if (recipe.authStyle === "body") {
      params.set("client_id", recipe.clientId);
      params.set("client_secret", recipe.clientSecret);
    }
    for (const [k, v] of Object.entries(recipe.extra ?? {})) params.set(k, v);
    body = params.toString();
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  } else {
    const payload: Record<string, string> = {
      grant_type: "client_credentials",
      ...(recipe.extra ?? {}),
    };
    if (recipe.authStyle === "body") {
      payload.client_id = recipe.clientId;
      payload.client_secret = recipe.clientSecret;
    }
    body = JSON.stringify(payload);
    headers["Content-Type"] = "application/json";
  }

  if (recipe.authStyle === "basic") {
    const basic = Buffer.from(`${recipe.clientId}:${recipe.clientSecret}`).toString("base64");
    headers["Authorization"] = `Basic ${basic}`;
  }

  try {
    const res = await fetchWithRetry(recipe.tokenUrl, {
      method: "POST",
      headers,
      body,
      timeoutMs: 6000,
      retries: 1,
    });

    if (!res.ok) return null;

    const json = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!json.access_token) return null;

    // Some providers (notably Product Hunt) don't return `expires_in` and
    // hand out effectively long-lived tokens. Fall back to a sane default
    // so we still cache + reuse the token instead of hitting the auth
    // endpoint on every request.
    const lifetimeSeconds =
      typeof json.expires_in === "number" ? json.expires_in : (recipe.fallbackTtlSeconds ?? 86_400);

    const expiresAt = Date.now() + lifetimeSeconds * 1000;
    setCache(key, { accessToken: json.access_token, expiresAt });
    return json.access_token;
  } catch {
    return null;
  }
}
