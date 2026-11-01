/** How long a new account gets bulletins and alerts before it must verify its email. */
export const UNVERIFIED_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Bulletins and alerts stop for an account that never verified its email within a week
 * of signing up, so a mistyped or someone else's address does not keep getting mail.
 */
export function receivesDelivery(
  user: { emailVerified: boolean; createdAt: Date },
  now: Date
): boolean {
  return user.emailVerified || now.getTime() - user.createdAt.getTime() < UNVERIFIED_GRACE_MS;
}
