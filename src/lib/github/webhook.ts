import { z } from "zod";

import { isScannedPath } from "@scan/files";

// What a verified webhook delivery asks for, decided without I/O. The route verifies the
// signature on the raw body first, then parses, then acts on these plans.

/** Larger deliveries are refused before the signature is computed (GitHub caps at 25 MB). */
export const MAX_WEBHOOK_BYTES = 5 * 1024 * 1024;

/** GitHub lists at most this many commits in a push; beyond it the file lists are partial. */
export const PUSH_COMMIT_LIMIT = 2048;

export type WebhookPlan =
  | { kind: "ignore"; reason: string }
  | { kind: "installation-deleted"; installationId: string }
  | { kind: "installation-suspended"; installationId: string; suspended: boolean }
  /** `repos: null` = every repo of the installation. */
  | { kind: "scan"; installationId: string; repos: string[] | null; reason: string }
  | { kind: "remove"; installationId: string; repos: string[] };

const id = z.union([z.number(), z.string()]).transform(String);
const installationRef = z.object({ id });
const repoRef = z.object({ full_name: z.string() });

const installationEvent = z.object({
  action: z.string(),
  installation: installationRef,
});

const installationReposEvent = z.object({
  action: z.string(),
  installation: installationRef,
  repositories_added: z.array(repoRef).default([]),
  repositories_removed: z.array(repoRef).default([]),
});

const commitFiles = z.object({
  added: z.array(z.string()).default([]),
  modified: z.array(z.string()).default([]),
  removed: z.array(z.string()).default([]),
});

const pushEvent = z.object({
  ref: z.string(),
  deleted: z.boolean().default(false),
  forced: z.boolean().default(false),
  installation: installationRef,
  repository: z.object({ full_name: z.string(), default_branch: z.string() }),
  commits: z.array(commitFiles).default([]),
});
export type PushEvent = z.input<typeof pushEvent>;

/**
 * Whether a push changes what the scanner reads: only pushes to the default branch, and
 * only when a changed path is a scanned file. A force push, or a push whose commit list
 * may be partial, is scanned (the files cannot be told from the payload).
 */
export function pushNeedsScan(event: z.infer<typeof pushEvent>): { scan: boolean; reason: string } {
  if (event.deleted) return { scan: false, reason: "branch deleted" };
  if (event.ref !== `refs/heads/${event.repository.default_branch}`) {
    return { scan: false, reason: "not the default branch" };
  }
  if (event.forced) return { scan: true, reason: "force push" };
  if (event.commits.length >= PUSH_COMMIT_LIMIT)
    return { scan: true, reason: "commit list partial" };
  const touched = event.commits.some((c) =>
    [...c.added, ...c.modified, ...c.removed].some((p) => isScannedPath(p))
  );
  return touched
    ? { scan: true, reason: "scanned files changed" }
    : { scan: false, reason: "no scanned file changed" };
}

export function planWebhook(event: string, payload: unknown): WebhookPlan[] {
  switch (event) {
    case "ping":
      return [{ kind: "ignore", reason: "ping" }];
    case "installation": {
      const e = installationEvent.parse(payload);
      const installationId = e.installation.id;
      if (e.action === "deleted") return [{ kind: "installation-deleted", installationId }];
      if (e.action === "suspend" || e.action === "unsuspend") {
        return [
          { kind: "installation-suspended", installationId, suspended: e.action === "suspend" },
        ];
      }
      // `created` is linked to an org by the setup flow, never by the webhook.
      return [{ kind: "ignore", reason: `installation ${e.action}` }];
    }
    case "installation_repositories": {
      const e = installationReposEvent.parse(payload);
      const installationId = e.installation.id;
      const plans: WebhookPlan[] = [];
      const added = e.repositories_added.map((r) => r.full_name);
      const removed = e.repositories_removed.map((r) => r.full_name);
      if (added.length > 0)
        plans.push({ kind: "scan", installationId, repos: added, reason: "repositories added" });
      if (removed.length > 0) plans.push({ kind: "remove", installationId, repos: removed });
      return plans.length > 0 ? plans : [{ kind: "ignore", reason: "no repositories" }];
    }
    case "push": {
      const e = pushEvent.parse(payload);
      const decision = pushNeedsScan(e);
      return decision.scan
        ? [
            {
              kind: "scan",
              installationId: e.installation.id,
              repos: [e.repository.full_name],
              reason: decision.reason,
            },
          ]
        : [{ kind: "ignore", reason: decision.reason }];
    }
    default:
      return [{ kind: "ignore", reason: `event ${event}` }];
  }
}
