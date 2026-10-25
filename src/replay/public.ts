import { runReplay } from "./engine";
import type { PublicReplayId } from "./public-ids";
import { SCENARIOS } from "./scenarios";
import type { ReplayEmail, ReplayResult } from "./types";

export { isPublicReplayId, PUBLIC_REPLAY_IDS, type PublicReplayId } from "./public-ids";

// The replays as the public site shows them (/replay/<id>, the landing page): the committed
// scenarios through the same engine as `npm run replay`. Scenario repo names are synthetic
// (acme, sigma/*, *.example), so they can be shown as they are.

const cache = new Map<PublicReplayId, ReplayResult>();

/** The replay's result, computed once per process (pure and deterministic). */
export function publicReplay(id: PublicReplayId): ReplayResult {
  let result = cache.get(id);
  if (!result) {
    result = runReplay(SCENARIOS[id]);
    cache.set(id, result);
  }
  return result;
}

export function replayEmails(result: ReplayResult): ReplayEmail[] {
  return result.entries.flatMap((e) => (e.briffEmail ? [e.briffEmail] : []));
}

export interface ReplayHighlight {
  /** When the fact Briff reacted to appeared, and what it was. */
  trigger: { at: Date; title: string };
  /** When Briff's email went out, its subject and the delay in minutes. */
  email: { at: Date; subject: string; delayMinutes: number };
}

/** Each urgent email next to the fact that triggered it, in send order. */
export function replayHighlights(result: ReplayResult): ReplayHighlight[] {
  return replayEmails(result).flatMap((m) =>
    m.kind === "urgent" && m.trigger && m.delayMinutes !== null
      ? [
          {
            trigger: m.trigger,
            email: { at: m.at, subject: m.subject, delayMinutes: m.delayMinutes },
          },
        ]
      : []
  );
}
