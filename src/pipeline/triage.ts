import { withOrg } from "@/lib/db/with-org";
import { getEnv } from "@/lib/env";
import { renderUrgentEmail, type UrgentItem } from "@/lib/email/alert-email";
import { sendMail, smtpConfig } from "@/lib/email/mailer";
import { orgRecipients } from "@/lib/email/recipients";
import { getLlm, jsonMany, TokenMeter, type JsonRequest, type LlmClient } from "@/llm/client";
import { loadPrompt } from "@/llm/prompts";
import type { JobContext, JobResult } from "@/worker/types";

import type { Bucket } from "./buckets";

import {
  interpretTriage,
  TRIAGE_JSON_SCHEMA,
  triageOutputSchema,
  type TriageDecision,
} from "./triage-schema";
import { ruleMinorReason } from "./versions";

// triage-items (plan §7.5): only items that the deterministic matcher tied to an
// org reach the LLM, each item is classified once, and only recent items are
// considered (older ones can never enter a bulletin, so classifying them is waste).

export const TRIAGE_BATCH_SIZE = 20;
export const TRIAGE_MAX_PER_RUN = 400;
const SCAN_LIMIT = 3000;
export const TRIAGE_MAX_AGE_DAYS = 14;
const TEXT_CHARS = 1500;

export interface TriageCandidate {
  id: string;
  title: string;
  url: string;
  rawText: string;
  publishedAt: Date | null;
  sourceName: string;
  matchedVia: string;
}

export function triageInput(batch: TriageCandidate[], today: Date): string {
  return JSON.stringify({
    today: today.toISOString().slice(0, 10),
    items: batch.map((item, i) => ({
      ref: i + 1,
      title: item.title,
      source: item.sourceName,
      url: item.url,
      published: item.publishedAt?.toISOString().slice(0, 10) ?? null,
      matched_via: item.matchedVia,
      text: item.rawText.slice(0, TEXT_CHARS),
    })),
  });
}

type TriageOutput = ReturnType<typeof triageOutputSchema.parse>;

export function triageRequest(
  model: string,
  batch: TriageCandidate[],
  today: Date
): JsonRequest<TriageOutput> {
  return {
    task: "triage",
    model,
    system: loadPrompt("triage").text,
    user: triageInput(batch, today),
    schema: TRIAGE_JSON_SCHEMA,
    parse: (v) => triageOutputSchema.parse(v),
    maxTokens: 8000,
    effort: "low",
  };
}

export async function classifyBatch(
  llm: LlmClient,
  model: string,
  batch: TriageCandidate[],
  today: Date
): Promise<{
  decisions: TriageDecision[];
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}> {
  const res = await llm.json(triageRequest(model, batch, today));
  const refs = batch.map((_, i) => i + 1);
  return { decisions: interpretTriage(refs, res.data), usage: res.usage, model: res.model };
}

/** Triage rows written by a rule rather than the model carry these instead of a model id. */
export const RULE_MODEL = "rule";
export const RULE_VERSION = "rule-v1";

/**
 * Pre-release and commit-sha tag titles are minor by rule: they never become
 * bulletin items and cost no LLM call. Each ruled item carries its reason.
 */
export function splitRuleMinor<T extends { title: string }>(
  candidates: T[]
): { ruled: { item: T; reason: string }[]; rest: T[] } {
  const ruled: { item: T; reason: string }[] = [];
  const rest: T[] = [];
  for (const c of candidates) {
    const reason = ruleMinorReason(c.title);
    if (reason) ruled.push({ item: c, reason });
    else rest.push(c);
  }
  return { ruled, rest };
}

/**
 * Only security interrupts the week. Model launches and pricing (mostly AI
 * Gateway posts in practice) wait for the weekly bulletin.
 */
export function isUrgentBucket(bucket: Bucket): bucket is UrgentItem["bucket"] {
  return bucket === "security";
}

interface UrgentCandidate {
  itemId: string;
  title: string;
  url: string;
  sourceName: string;
  bucket: UrgentItem["bucket"];
  reason: string;
}

/** Urgent items this org should hear about now: matched, and not only via excluded repos. */
export function urgentForOrg(
  urgent: UrgentCandidate[],
  matches: { itemId: string; repoIds: string[] }[],
  includedRepos: ReadonlyMap<string, string>
): UrgentItem[] {
  const byItem = new Map(matches.map((m) => [m.itemId, m.repoIds]));
  return urgent.flatMap((u) => {
    const repoIds = byItem.get(u.itemId);
    if (!repoIds) return [];
    const visible = repoIds.filter((id) => includedRepos.has(id));
    if (repoIds.length > 0 && visible.length === 0) return [];
    return [
      {
        title: u.title,
        url: u.url,
        bucket: u.bucket,
        reason: u.reason,
        sourceName: u.sourceName,
        affectedRepos: [...new Set(visible.map((id) => includedRepos.get(id) as string))].sort(),
      },
    ];
  });
}

export async function triageItems({ db, log, heartbeat }: JobContext): Promise<JobResult> {
  const env = getEnv();
  const counts = {
    candidates: 0,
    waitingExcluded: 0,
    batches: 0,
    batchErrors: 0,
    triaged: 0,
    deadlines: 0,
    urgent: 0,
    urgentEmails: 0,
    llmUnavailable: 0,
    ruleMinor: 0,
  };
  const meter = new TokenMeter();
  const now = new Date();
  const since = new Date(now.getTime() - TRIAGE_MAX_AGE_DAYS * 86_400_000);

  const rows = await db.item.findMany({
    where: {
      triage: null,
      matches: { some: {} },
      OR: [{ publishedAt: { gte: since } }, { publishedAt: null, createdAt: { gte: since } }],
    },
    select: {
      id: true,
      title: true,
      url: true,
      rawText: true,
      publishedAt: true,
      source: { select: { name: true } },
      // System read across orgs: which repos pulled the item in, to skip excluded-only items.
      matches: { select: { reason: true, score: true, repoIds: true }, orderBy: { score: "desc" } },
    },
    orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: SCAN_LIMIT,
  });
  const orgs = await db.org.findMany({ select: { id: true } });
  const included = new Set<string>();
  for (const org of orgs) {
    const repos = await withOrg(db, org.id).repo.findMany({
      where: { included: true },
      select: { id: true },
    });
    for (const r of repos) included.add(r.id);
  }
  // Items reached only through excluded repos wait; including a repo later makes them eligible.
  const eligible = rows
    .filter((r) =>
      r.matches.some((m) => {
        const ids = Array.isArray(m.repoIds) ? m.repoIds.map(String) : [];
        return ids.length === 0 || ids.some((id) => included.has(id));
      })
    )
    .slice(0, TRIAGE_MAX_PER_RUN);
  counts.candidates = eligible.length;
  counts.waitingExcluded = rows.length - eligible.length;
  if (eligible.length === 0) return { counts };

  const { ruled, rest: toClassify } = splitRuleMinor(eligible);
  if (ruled.length > 0) {
    const created = await db.itemTriage.createMany({
      data: ruled.map(({ item, reason }) => ({
        itemId: item.id,
        bucket: "minor" as const,
        reason,
        model: RULE_MODEL,
        promptVersion: RULE_VERSION,
      })),
      skipDuplicates: true,
    });
    counts.ruleMinor = created.count;
    counts.triaged += created.count;
  }
  if (toClassify.length === 0) {
    log.info(counts, "triage: done");
    return { counts };
  }

  const llm = getLlm();
  if (!llm.ok) {
    counts.llmUnavailable = 1;
    log.warn(
      { reason: llm.reason, pending: toClassify.length },
      "triage: LLM unavailable, skipping"
    );
    return { counts };
  }

  const candidates: TriageCandidate[] = toClassify.map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url,
    rawText: r.rawText,
    publishedAt: r.publishedAt,
    sourceName: r.source.name,
    matchedVia: r.matches[0]?.reason ?? "",
  }));
  const prompt = loadPrompt("triage");
  const urgent: UrgentCandidate[] = [];

  // Every request of 20 items goes into one Message Batch (or one call each without batching).
  const batches: TriageCandidate[][] = [];
  for (let i = 0; i < candidates.length; i += TRIAGE_BATCH_SIZE) {
    batches.push(candidates.slice(i, i + TRIAGE_BATCH_SIZE));
  }
  counts.batches = batches.length;
  const { entries, batch: billedAsBatch } = await jsonMany(
    llm.client,
    batches.map((b) => triageRequest(env.BRIFF_MODEL_TRIAGE, b, now)),
    { batch: llm.batch, onPoll: heartbeat }
  );

  for (const [index, entry] of entries.entries()) {
    const batch = batches[index];
    if (!entry.ok) {
      counts.batchErrors++;
      log.warn({ err: entry.error, size: batch.length }, "triage: batch failed");
      continue;
    }
    const result = {
      decisions: interpretTriage(
        batch.map((_, i) => i + 1),
        entry.response.data
      ),
      model: entry.response.model,
    };
    meter.add("triage", result.model, entry.response.usage, {
      batch: llm.batch ? billedAsBatch : undefined,
    });

    for (const decision of result.decisions) {
      const item = batch[decision.ref - 1];
      const created = await db.itemTriage.createMany({
        data: [
          {
            itemId: item.id,
            bucket: decision.bucket,
            reason: decision.reason,
            packages: decision.packages,
            dueAt: decision.dueAt,
            dueWhat: decision.dueWhat,
            model: result.model,
            promptVersion: prompt.version,
          },
        ],
        skipDuplicates: true,
      });
      if (created.count === 0) continue;
      counts.triaged++;

      if (decision.bucket === "deadline" && decision.dueAt && decision.dueWhat) {
        await db.item.update({ where: { id: item.id }, data: { effectiveDate: decision.dueAt } });
        for (const org of orgs) {
          const scoped = withOrg(db, org.id);
          const match = await scoped.itemMatch.findFirst({
            where: { itemId: item.id },
            select: { repoIds: true },
          });
          if (!match) continue;
          const exists = await scoped.deadline.count({ where: { itemId: item.id } });
          if (exists > 0) continue;
          await scoped.deadline.create({
            data: {
              orgId: org.id,
              itemId: item.id,
              what: decision.dueWhat,
              dueAt: decision.dueAt,
              affectedRepos: match.repoIds ?? [],
              confirmed: false,
            },
          });
          counts.deadlines++;
        }
      }
      if (isUrgentBucket(decision.bucket)) {
        urgent.push({
          itemId: item.id,
          title: item.title,
          url: item.url,
          sourceName: item.sourceName,
          bucket: decision.bucket,
          reason: decision.reason,
        });
      }
    }
  }

  if (counts.batches > 0 && counts.batchErrors === counts.batches) {
    throw new Error(`all ${counts.batches} triage batches failed`);
  }

  counts.urgent = urgent.length;
  const smtp = smtpConfig();
  if (urgent.length > 0 && env.BRIFF_URGENT_EMAIL && smtp) {
    for (const org of orgs) {
      const scoped = withOrg(db, org.id);
      const [matches, repos] = await Promise.all([
        scoped.itemMatch.findMany({
          where: { itemId: { in: urgent.map((u) => u.itemId) } },
          select: { itemId: true, repoIds: true },
        }),
        scoped.repo.findMany({ where: { included: true }, select: { id: true, name: true } }),
      ]);
      const items = urgentForOrg(
        urgent,
        matches.map((m) => ({
          itemId: m.itemId,
          repoIds: Array.isArray(m.repoIds) ? m.repoIds.map(String) : [],
        })),
        new Map(repos.map((r) => [r.id, r.name]))
      );
      if (items.length === 0) continue;
      for (const recipient of await orgRecipients(db, org.id)) {
        const result = await sendMail(
          {
            to: recipient.to,
            ...renderUrgentEmail(recipient.language, items, env.BETTER_AUTH_URL),
          },
          smtp
        );
        if (result.status === "sent") counts.urgentEmails++;
        else log.warn({ orgId: org.id, result }, "triage: urgent email not sent");
      }
    }
  } else if (urgent.length > 0) {
    log.info(
      { urgent: urgent.length, flag: env.BRIFF_URGENT_EMAIL, smtp: smtp !== null },
      "triage: urgent email off"
    );
  }

  log.info(counts, "triage: done");
  return { counts, tokens: meter.toJSON() };
}
