export type InviteRole = "member" | "owner";

export const DEFAULT_INVITE_ROLE: InviteRole = "member";

/**
 * The role the invite form shows after an action result. React resets the form after the
 * action, but the role Select keeps its own state: a sent invite goes back to Member, so an
 * Owner choice never carries over to the next invitee; a failed send keeps the choice to retry.
 */
export function roleAfterInvite(role: InviteRole, result: { ok: boolean }): InviteRole {
  return result.ok ? DEFAULT_INVITE_ROLE : role;
}
