// The replays the public site shows at /replay/<id> (src/replay/public.ts). Kept apart from the
// engine so the sitemap and robots can list them without running a replay.
export const PUBLIC_REPLAY_IDS = ["php2shell", "node-oct-2026"] as const;
export type PublicReplayId = (typeof PUBLIC_REPLAY_IDS)[number];

export function isPublicReplayId(id: string): id is PublicReplayId {
  return (PUBLIC_REPLAY_IDS as readonly string[]).includes(id);
}
