import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import type { Logger } from "@/lib/log";
import { acceptScan } from "@/lib/scan/accept";
import { collectFromFiles, type ScanRepoPayload } from "@scan/collect";
import { isScannedPath } from "@scan/files";
import type { JobContext, JobResult } from "@/worker/types";

import { enqueueJob } from "@/lib/jobs/queue";

import {
  appJwt,
  createInstallationToken,
  getBlobText,
  getBranchHead,
  getRepo,
  getTree,
  listInstallationRepos,
  type GithubRepo,
  GithubApiError,
  GithubRateLimitError,
  type GithubTree,
  type Http,
} from "./api";
import { githubAppConfig, type GithubAppConfig } from "./config";
import { findInstallation } from "./installations";

// github-scan job: list the installation's repos (or the named ones), and for each default
// branch whose head moved, read the tree (paths only), fetch the blobs the scanner reads
// (`isScannedPath`) and build the same payload the CLI would (`collectFromFiles`). All repos
// of one job are one scan session: one ingest per 500 repos, the last one `final`.

/** Repos one job payload may name; longer follow-ups are split. */
export const MAX_PAYLOAD_REPOS = 1000;

export const githubScanPayloadSchema = z.object({
  installationId: z.string().min(1).max(32),
  /** Full names (`owner/repo`); absent = every repo of the installation. */
  repos: z.array(z.string().min(3).max(200)).max(MAX_PAYLOAD_REPOS).optional(),
  /** Rescan even when the default-branch head did not move (setup, repos added). */
  force: z.boolean().optional(),
  /** Follow-up of a scan whose repos failed: how many times already (gives up at MAX_RETRIES). */
  retry: z.number().int().min(0).max(10).optional(),
});
export type GithubScanPayload = z.infer<typeof githubScanPayloadSchema>;

/** Every scan key of an installation starts with this. */
export function githubScanKeyPrefix(installationId: string): string {
  return `github-scan:${installationId}:`;
}

/** One pending scan per installation and repo set. */
export function githubScanKey(payload: GithubScanPayload): string {
  const repos = payload.repos
    ? createHash("sha256")
        .update([...payload.repos].sort().join("\n"))
        .digest("hex")
    : "*";
  // A forced scan keeps its own key: deduped into a pending ordinary scan it would lose `force`.
  return `${githubScanKeyPrefix(payload.installationId)}${repos}${payload.force ? ":force" : ""}`;
}

/** Per repo: blobs fetched at most, and the largest blob read (tree entry size). */
export const MAX_FILES_PER_REPO = 400;
/** Follow-up scans for repos that failed with a non-rate-limit error. */
export const MAX_RETRIES = 3;
export const RETRY_DELAY_MS = 10 * 60_000;
export const MAX_BLOB_BYTES = 10 * 1024 * 1024;
const INGEST_CHUNK = 500;

/** Tree entries the scanner reads: regular files (no symlinks, no submodules) on scanned paths. */
export function scannedTreeEntries(tree: GithubTree): GithubTree["tree"] {
  return selectBlobs(tree).entries;
}

/**
 * The blobs to fetch within the budget (MAX_FILES_PER_REPO, MAX_BLOB_BYTES), and whether the
 * budget left any scanned file out: such a read is incomplete like a parse failure.
 */
export function selectBlobs(tree: GithubTree): { entries: GithubTree["tree"]; cut: boolean } {
  const scanned = tree.tree.filter(
    (e) =>
      e.type === "blob" && (e.mode === "100644" || e.mode === "100755") && isScannedPath(e.path)
  );
  const fitting = scanned.filter((e) => (e.size ?? 0) <= MAX_BLOB_BYTES);
  const entries = fitting.slice(0, MAX_FILES_PER_REPO);
  return { entries, cut: entries.length < scanned.length };
}

const tokenCache = new Map<string, { token: string; expiresAt: Date }>();

async function installationToken(
  http: Http,
  config: GithubAppConfig,
  installationId: string,
  now: Date
): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt.getTime() - now.getTime() > 5 * 60_000) return cached.token;
  const fresh = await createInstallationToken(
    http,
    appJwt(config.appId, config.privateKey, now),
    installationId
  );
  tokenCache.set(installationId, fresh);
  return fresh.token;
}

export interface ScanInstallationResult {
  counts: ReturnType<typeof emptyCounts>;
}

export async function scanInstallation(args: {
  db: PrismaClient;
  http: Http;
  config: GithubAppConfig;
  payload: GithubScanPayload;
  scanId: string;
  log: Logger;
  heartbeat: () => Promise<void>;
  now?: Date;
}): Promise<ScanInstallationResult | { skipped: string }> {
  const { db, http, config, log } = args;
  let payload = args.payload;
  const now = args.now ?? new Date();
  const row = await findInstallation(db, payload.installationId);
  if (!row) return { skipped: "installation not linked to an org" };
  if (row.suspendedAt) return { skipped: "installation suspended" };
  const scoped = withOrg(db, row.orgId);
  const token = await installationToken(http, config, payload.installationId, now);

  let repos: GithubRepo[] = [];
  const failed: string[] = [];
  let inaccessible = 0;
  if (payload.repos) {
    // One repo that was deleted, renamed or taken out of the installation must not block
    // the others: metadata is read per repo.
    for (const [index, full] of payload.repos.entries()) {
      try {
        repos.push(await getRepo(http, token, full));
      } catch (err) {
        if (err instanceof GithubRateLimitError) {
          await followUp(db, { ...payload, repos: payload.repos.slice(index) }, err.retryAt);
          log.warn({ retryAt: err.retryAt }, "github-scan: rate limited reading repos, deferred");
          payload = { ...payload, repos: payload.repos.slice(0, index) };
          break;
        }
        if (err instanceof GithubApiError && (err.status === 404 || err.status === 403)) {
          inaccessible++;
          log.info({ repo: full, status: err.status }, "github-scan: repo not accessible, skipped");
        } else {
          failed.push(full);
          log.warn({ err, repo: full }, "github-scan: repo metadata failed");
        }
      }
    }
  } else {
    try {
      repos = await listInstallationRepos(http, token);
    } catch (err) {
      if (!(err instanceof GithubRateLimitError)) throw err;
      await followUp(db, { ...payload }, err.retryAt);
      log.warn(
        { retryAt: err.retryAt },
        "github-scan: rate limited before listing repos, deferred"
      );
      return { counts: { ...emptyCounts(), rateLimited: 1 } };
    }
  }
  const known = new Map(
    (
      await scoped.repo.findMany({
        where: { source: "github", name: { in: repos.map((r) => r.full_name) } },
        select: { name: true, githubHeadSha: true, githubInstallationId: true },
      })
    ).map((r) => [r.name, r])
  );

  const counts = {
    ...emptyCounts(),
    repos: repos.length,
    inaccessible,
    repoErrors: failed.length,
  };
  const payloads: { payload: ScanRepoPayload; headSha: string | null }[] = [];
  let deferred: { repos: string[]; retryAt: Date } | null = null;
  for (const [index, repo] of repos.entries()) {
    await args.heartbeat();
    if (repo.archived) {
      counts.archived++;
      continue;
    }
    try {
      const head = await getBranchHead(http, token, repo.full_name, repo.default_branch);
      const stored = known.get(repo.full_name);
      if (
        !payload.force &&
        stored?.githubHeadSha === head.commitSha &&
        stored.githubInstallationId === row.id
      ) {
        counts.unchanged++;
        continue;
      }
      const tree = await getTree(http, token, repo.full_name, head.treeSha);
      if (tree.truncated) {
        counts.truncatedTrees++;
        log.warn({ repo: repo.full_name }, "github-scan: tree truncated, scanning what was listed");
      }
      const { entries, cut } = selectBlobs(tree);
      const files: Record<string, string> = {};
      for (const entry of entries) {
        files[entry.path] = await getBlobText(http, token, repo.full_name, entry.sha);
        counts.filesFetched++;
      }
      let skippedFiles = 0;
      const collected = await collectFromFiles(repo.full_name, files, {
        warn: (message) => {
          skippedFiles++;
          log.warn({ repo: repo.full_name, message }, "github-scan: file skipped");
        },
      });
      const complete = skippedFiles === 0 && !tree.truncated && !cut;
      if (!complete && stored) {
        // A file failed to parse or the tree was cut: never replace a stored snapshot with a
        // partial one, and leave the head unrecorded so the next push or scan tries again.
        counts.partial++;
        log.warn(
          { repo: repo.full_name, skippedFiles, truncated: tree.truncated, overBudget: cut },
          "github-scan: partial read, stored snapshot kept"
        );
      } else if (collected) {
        // A new repo gets what could be read; its head is recorded only for a complete read.
        payloads.push({ payload: collected, headSha: complete ? head.commitSha : null });
        if (!complete) counts.partial++;
      } else if (stored) {
        // The repo no longer declares anything (its last lockfile went): store the empty
        // snapshot so old dependencies stop driving matches.
        payloads.push({ payload: emptySnapshot(repo.full_name), headSha: head.commitSha });
        counts.emptied++;
      } else {
        counts.noFiles++;
      }
    } catch (err) {
      if (err instanceof GithubRateLimitError) {
        // Keep what was read; the rest waits for GitHub's reset time.
        deferred = {
          repos: repos.slice(index).map((r) => r.full_name),
          retryAt: err.retryAt,
        };
        break;
      }
      counts.repoErrors++;
      failed.push(repo.full_name);
      log.warn({ err, repo: repo.full_name }, "github-scan: repo failed");
    }
  }

  for (let i = 0; i < payloads.length; i += INGEST_CHUNK) {
    const chunk = payloads.slice(i, i + INGEST_CHUNK);
    const accepted = await acceptScan(
      db,
      row.orgId,
      {
        source: "github",
        repos: chunk.map((p) => p.payload),
        scanId: args.scanId,
        final: i + INGEST_CHUNK >= payloads.length,
      },
      now,
      { skipRepoLimit: true, completeSnapshots: true }
    );
    const acceptedNames = new Set(accepted.repos.map((r) => r.name));
    counts.repoLimitSkipped += chunk.length - accepted.repos.length;
    for (const p of chunk) {
      if (!acceptedNames.has(p.payload.name)) continue;
      await scoped.repo.updateMany({
        where: { source: "github", name: p.payload.name },
        data: { githubInstallationId: row.id, githubHeadSha: p.headSha },
      });
    }
    counts.ingested += accepted.repos.length;
  }

  if (counts.repoLimitSkipped)
    await db.org.update({ where: { id: row.orgId }, data: { githubRepoLimitReached: true } });
  if (deferred) {
    await followUp(db, { ...payload, repos: deferred.repos }, deferred.retryAt);
    counts.rateLimited = 1;
    log.warn(
      { remaining: deferred.repos.length, retryAt: deferred.retryAt },
      "github-scan: rate limited, rest deferred to the reset time"
    );
  }
  if (failed.length > 0) {
    const retry = (payload.retry ?? 0) + 1;
    if (retry <= MAX_RETRIES) {
      await followUp(
        db,
        { ...payload, repos: failed, retry },
        new Date(now.getTime() + RETRY_DELAY_MS * retry)
      );
      counts.retriesQueued = failed.length;
    } else {
      log.error(
        { repos: failed },
        "github-scan: repos still failing, giving up until the next push"
      );
    }
  }
  return { counts };
}

function emptyCounts() {
  return {
    repos: 0,
    unchanged: 0,
    noFiles: 0,
    emptied: 0,
    archived: 0,
    truncatedTrees: 0,
    partial: 0,
    filesFetched: 0,
    repoErrors: 0,
    inaccessible: 0,
    retriesQueued: 0,
    rateLimited: 0,
    ingested: 0,
    repoLimitSkipped: 0,
  };
}

function emptySnapshot(name: string): ScanRepoPayload {
  return { name, path: name, ecosystem: "npm", dependencies: [], runtimes: [] };
}

/**
 * A later scan of (part of) this payload, split into jobs within the payload's repo limit;
 * each has its own dedupe key, so it never merges into the running job.
 */
async function followUp(db: PrismaClient, payload: GithubScanPayload, runAfter: Date) {
  const parts = payload.repos
    ? Array.from({ length: Math.ceil(payload.repos.length / MAX_PAYLOAD_REPOS) }, (_, i) =>
        payload.repos?.slice(i * MAX_PAYLOAD_REPOS, (i + 1) * MAX_PAYLOAD_REPOS)
      )
    : [undefined];
  for (const repos of parts) {
    const part: GithubScanPayload = { ...payload, repos };
    await enqueueJob(db, "github-scan", {
      payload: { ...part },
      dedupeKey: githubScanKey(part),
      runAfter,
      maxAttempts: 6,
    });
  }
}

/** Job handler; the HTTP client is the global fetch. */
export async function githubScan({
  db,
  log,
  payload,
  jobId,
  heartbeat,
}: JobContext): Promise<JobResult> {
  const config = githubAppConfig();
  if (!config) {
    log.warn({}, "github-scan: GitHub App not configured, skipping");
    return { counts: { notConfigured: 1 } };
  }
  const parsed = githubScanPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    log.warn({ issues: parsed.error.issues }, "github-scan: invalid payload");
    return { counts: { invalidPayload: 1 } };
  }
  const result = await scanInstallation({
    db,
    http: (url, init) => fetch(url, init),
    config,
    payload: parsed.data,
    scanId: `github-${jobId}`,
    log,
    heartbeat,
  });
  if ("skipped" in result) {
    log.info(
      { installationId: parsed.data.installationId, reason: result.skipped },
      "github-scan: skipped"
    );
    return { counts: { skipped: 1 } };
  }
  log.info({ installationId: parsed.data.installationId, ...result.counts }, "github-scan: done");
  return { counts: result.counts };
}
