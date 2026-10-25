import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { getEnv } from "@/lib/env";
import { renderUrgentEmail } from "@/lib/email/alert-email";
import { sendMail, smtpConfig } from "@/lib/email/mailer";
import { orgRecipients } from "@/lib/email/recipients";
import type { Logger } from "@/lib/log";
import { RUNTIME_SECURITY_REASON } from "@/lib/runtime-security";

import {
  handledMatchUpdate,
  planRuntimeUrgent,
  RUNTIME_MATCH_LOOKBACK_MS,
  selectRuntimeWork,
  type StoredRuntimeMatch,
} from "./runtime-urgent-plan";
import { RULE_MODEL } from "./triage-rule";

// The DB and SMTP half of the deterministic urgent path: loads pending runtime security
// matches, plans them with runtime-urgent-plan.ts (pure, shared with the replay engine)
// and emails each org once per run.

function stringIds(value: Prisma.JsonValue | null): string[] | null {
  return Array.isArray(value) ? value.map(String) : null;
}

export interface RuntimeUrgentCounts {
  runtimeUrgent: number;
  runtimeUrgentSkipped: number;
  runtimeUrgentEmails: number;
  runtimeUrgentFailed: number;
  runtimeUrgentNoRecipients: number;
  /** Sent matches that were "also affects" or "fix is out" follow-ups. */
  runtimeUrgentFollowUps: number;
  /** 1 when another pass held the delivery lock and this one sent nothing. */
  runtimeUrgentLocked: number;
}

function emptyCounts(): RuntimeUrgentCounts {
  return {
    runtimeUrgent: 0,
    runtimeUrgentSkipped: 0,
    runtimeUrgentEmails: 0,
    runtimeUrgentFailed: 0,
    runtimeUrgentNoRecipients: 0,
    runtimeUrgentFollowUps: 0,
    runtimeUrgentLocked: 0,
  };
}

/** Advisory lock key (two-int form, its own key space) held for a whole delivery pass. */
const URGENT_LOCK_CLASS = 7311;
const URGENT_LOCK_NAME = "runtime-urgent-delivery";
/** Upper bound of one pass; matches the stale job lock, after which the job is retried anyway. */
const URGENT_LOCK_HOLD_MS = 30 * 60_000;

export interface RuntimeUrgentScope {
  /** Only these orgs (a scan-triggered pass); every org when absent. */
  orgIds?: readonly string[];
}

/**
 * Emails pending runtime security matches; one email per org and run. Passes are
 * serialised across workers by a Postgres advisory lock held for the whole pass:
 * `urgentAt` is written only after SMTP delivery, so two concurrent passes would both
 * see a match as pending and send it twice. A pass that cannot take the lock sends
 * nothing (`runtimeUrgentLocked`); the next hourly run picks the matches up.
 * `heartbeat` (the job's) runs before every org and every send: a lost job lock throws
 * JobLockLostError and stops the loop before another worker could send the same email.
 */
export async function sendRuntimeUrgent(
  db: PrismaClient,
  log: Logger,
  now: Date,
  heartbeat: () => Promise<void> = async () => {},
  scope: RuntimeUrgentScope = {}
): Promise<RuntimeUrgentCounts> {
  // The transaction only holds the lock (released at commit or rollback); the pass itself
  // runs on other pool connections.
  return db.$transaction(
    async (tx) => {
      const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${URGENT_LOCK_CLASS}::int, hashtext(${URGENT_LOCK_NAME})) AS locked`;
      if (!row?.locked) {
        log.info(
          { orgIds: scope.orgIds ?? null },
          "runtime urgent: another pass is running, skipped"
        );
        return { ...emptyCounts(), runtimeUrgentLocked: 1 };
      }
      return deliverRuntimeUrgent(db, log, now, heartbeat, scope);
    },
    { maxWait: 10_000, timeout: URGENT_LOCK_HOLD_MS }
  );
}

async function deliverRuntimeUrgent(
  db: PrismaClient,
  log: Logger,
  now: Date,
  heartbeat: () => Promise<void>,
  scope: RuntimeUrgentScope
): Promise<RuntimeUrgentCounts> {
  const env = getEnv();
  const counts = emptyCounts();
  const since = new Date(now.getTime() - RUNTIME_MATCH_LOOKBACK_MS);
  const smtp = smtpConfig();
  const orgs = await db.org.findMany({
    where: scope.orgIds ? { id: { in: [...scope.orgIds] } } : undefined,
    select: { id: true },
  });

  for (const org of orgs) {
    await heartbeat();
    const scoped = withOrg(db, org.id);
    const matches = await scoped.itemMatch.findMany({
      where: {
        reason: { contains: "runtime:" },
        item: {
          triage: { reason: RUNTIME_SECURITY_REASON, model: RULE_MODEL },
          OR: [{ publishedAt: { gte: since } }, { publishedAt: null, createdAt: { gte: since } }],
        },
      },
      select: {
        id: true,
        repoIds: true,
        urgentAt: true,
        urgentRepoIds: true,
        fixNotifiedAt: true,
        item: {
          select: {
            title: true,
            url: true,
            contentHash: true,
            metadata: true,
            publishedAt: true,
            createdAt: true,
            source: { select: { name: true, runtime: true } },
          },
        },
      },
    });
    const stored: StoredRuntimeMatch[] = matches.flatMap((m) =>
      m.item.source.runtime
        ? [
            {
              matchId: m.id,
              repoIds: stringIds(m.repoIds) ?? [],
              title: m.item.title,
              url: m.item.url,
              sourceName: m.item.source.name,
              runtime: m.item.source.runtime,
              metadata: m.item.metadata,
              publishedAt: m.item.publishedAt,
              contentHash: m.item.contentHash,
              createdAt: m.item.createdAt,
              urgentAt: m.urgentAt,
              urgentRepoIds: stringIds(m.urgentRepoIds),
              fixNotifiedAt: m.fixNotifiedAt,
            },
          ]
        : []
    );
    const byId = new Map(stored.map((m) => [m.matchId, m]));
    const pending = selectRuntimeWork(stored, now);
    if (pending.length === 0) continue;

    const repos = await scoped.repo.findMany({
      where: { included: true },
      select: { id: true, name: true },
    });
    const includedRepos = new Map(repos.map((r) => [r.id, r.name]));
    const runtimeRows = await scoped.repoRuntime.findMany({
      where: {
        repoId: { in: [...includedRepos.keys()] },
        name: { in: [...new Set(pending.map((p) => p.runtime))] },
      },
      select: {
        repoId: true,
        name: true,
        version: true,
        normalized: true,
        source: true,
        unresolved: true,
        image: true,
        constraint: true,
      },
    });
    const plan = planRuntimeUrgent(
      pending,
      includedRepos,
      runtimeRows.map((r) => ({ ...r, repo: includedRepos.get(r.repoId) as string })),
      now
    );
    const kindOf = new Map(pending.map((p) => [p.matchId, p.followUp?.kind ?? ("new" as const)]));
    const fixCarried = new Set(plan.fixCarried);
    const markHandled = async (ids: readonly string[]) => {
      for (const id of ids) {
        const m = byId.get(id);
        if (!m) continue;
        await scoped.itemMatch.update({
          where: { id },
          data: handledMatchUpdate(
            m,
            plan.covered[id] ?? [],
            kindOf.get(id) ?? "new",
            now,
            fixCarried.has(id)
          ),
        });
      }
    };
    if (plan.skip.length > 0) {
      await markHandled(plan.skip);
      counts.runtimeUrgentSkipped += plan.skip.length;
    }
    if (plan.items.length === 0) continue;
    counts.runtimeUrgent += plan.items.length;
    if (!env.BRIFF_URGENT_EMAIL || !smtp) {
      log.info(
        {
          orgId: org.id,
          pending: plan.items.length,
          flag: env.BRIFF_URGENT_EMAIL,
          smtp: smtp !== null,
        },
        "collect: runtime urgent email off, left pending"
      );
      continue;
    }

    const recipients = await orgRecipients(db, org.id);
    let sent = 0;
    for (const recipient of recipients) {
      await heartbeat();
      const result = await sendMail(
        {
          to: recipient.to,
          ...renderUrgentEmail(recipient.language, plan.items, env.BETTER_AUTH_URL),
        },
        smtp
      );
      if (result.status === "sent") sent++;
      else log.warn({ orgId: org.id, result }, "collect: runtime urgent email not sent");
    }
    counts.runtimeUrgentEmails += sent;
    // Covered once a member got it. No recipients or a total failure stays pending: a member
    // added later, or the next run, still gets it while the item is young enough.
    if (sent > 0) {
      await markHandled(plan.send);
      counts.runtimeUrgentFollowUps += plan.send.filter((id) => kindOf.get(id) !== "new").length;
    } else if (recipients.length === 0) {
      counts.runtimeUrgentNoRecipients += plan.items.length;
      log.info(
        { orgId: org.id, pending: plan.items.length },
        "collect: runtime urgent, org has no members"
      );
    } else {
      counts.runtimeUrgentFailed += plan.items.length;
    }
  }
  return counts;
}
