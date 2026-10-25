import { createHmac, timingSafeEqual } from "node:crypto";

// Signed `state` for the install and verify redirects: binds the round trip through
// GitHub to the org and user that started it, for STATE_TTL_MS. Keyed from
// BETTER_AUTH_SECRET with its own label, like the feedback tokens.

export const STATE_TTL_MS = 30 * 60_000;

export interface InstallState {
  /** `install`: GitHub → setup URL; `verify`: GitHub OAuth → callback. */
  purpose: "install" | "verify";
  orgId: string;
  userId: string;
  /** Set on `verify`: the installation the user must be able to access. */
  installationId?: string;
  /** Expiry, ms since epoch. */
  exp: number;
}

function key(secret: string): Buffer {
  return createHmac("sha256", secret).update("briff:github-state:v1").digest();
}

function mac(secret: string, body: string): string {
  return createHmac("sha256", key(secret)).update(body).digest("base64url");
}

export function signState(
  secret: string,
  state: Omit<InstallState, "exp">,
  now: Date = new Date()
): string {
  const body = Buffer.from(
    JSON.stringify({ ...state, exp: now.getTime() + STATE_TTL_MS })
  ).toString("base64url");
  return `${body}.${mac(secret, body)}`;
}

/** The state when its MAC is valid and it has not expired; null otherwise. */
export function verifyState(
  secret: string,
  token: string | null,
  now: Date = new Date()
): InstallState | null {
  if (!token || token.length > 2000) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = Buffer.from(mac(secret, body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const s = parsed as Partial<InstallState>;
  if (
    (s.purpose !== "install" && s.purpose !== "verify") ||
    typeof s.orgId !== "string" ||
    typeof s.userId !== "string" ||
    typeof s.exp !== "number" ||
    (s.installationId !== undefined && typeof s.installationId !== "string")
  ) {
    return null;
  }
  if (s.exp <= now.getTime()) return null;
  return s as InstallState;
}
