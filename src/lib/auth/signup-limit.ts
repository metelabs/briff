import "server-only";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Attempts per IP per hour on the auth endpoints that send email or check a password.
 * Better Auth's own `rateLimit` only sees HTTP requests; Server Actions call `auth.api.*`
 * directly, so the before-hook enforces the same windows through `authAttemptAllowed`.
 */
export const AUTH_LIMITS = {
  "/sign-up/email": 5,
  "/request-password-reset": 3,
  "/send-verification-email": 3,
  "/change-email": 3,
  "/change-password": 10,
} as const satisfies Record<string, number>;

export type LimitedAuthPath = keyof typeof AUTH_LIMITS;

export function isLimitedAuthPath(path: string): path is LimitedAuthPath {
  return Object.hasOwn(AUTH_LIMITS, path);
}

/** Better Auth `rateLimit.customRules` for the same paths. */
export function authRateLimitRules(): Record<LimitedAuthPath, { window: number; max: number }> {
  const entries = Object.entries(AUTH_LIMITS).map(([path, max]) => [
    path,
    { window: HOUR_MS / 1000, max },
  ]);
  return Object.fromEntries(entries) as Record<LimitedAuthPath, { window: number; max: number }>;
}

const windows = new Map<string, { attempts: number; expiresAt: number }>();

// Auth hooks run for both HTTP handlers and direct Server Action API calls.
export function authAttemptAllowed(
  path: LimitedAuthPath,
  ip: string | null | undefined,
  now = Date.now()
): boolean {
  for (const [key, window] of windows) {
    if (window.expiresAt <= now) windows.delete(key);
  }
  const key = `${path} ${ip?.trim() || "unknown"}`;
  const window = windows.get(key) ?? { attempts: 0, expiresAt: now + HOUR_MS };
  windows.set(key, window);
  if (window.attempts >= AUTH_LIMITS[path]) return false;
  window.attempts++;
  return true;
}

export function signupAllowed(ip: string | null | undefined, now = Date.now()): boolean {
  return authAttemptAllowed("/sign-up/email", ip, now);
}
