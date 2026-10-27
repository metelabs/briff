import "server-only";

const windows = new Map<string, { attempts: number; expiresAt: number }>();
const HOUR_MS = 60 * 60 * 1000;

// Auth hooks run for both HTTP handlers and direct Server Action API calls.
export function signupAllowed(ip: string | null | undefined, now = Date.now()): boolean {
  for (const [key, window] of windows) {
    if (window.expiresAt <= now) windows.delete(key);
  }
  const key = ip?.trim() || "unknown";
  const window = windows.get(key) ?? { attempts: 0, expiresAt: now + HOUR_MS };
  windows.set(key, window);
  if (window.attempts >= 5) return false;
  window.attempts++;
  return true;
}
