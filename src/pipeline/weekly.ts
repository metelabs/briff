import { upcomingEol } from "./runtime-eol-facts";
import { storedActionTags } from "@/sources/github-actions";
import { createHash } from "node:crypto";
import { loadBaseImageGroups } from "@/security/base-image-view";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { getEnv } from "@/lib/env";
import { PRODUCT_LANGUAGE, strings, type Language } from "@/lib/i18n";
import { getLlm, jsonMany, TokenMeter, type JsonRequest, type JsonResponse } from "@/llm/client";
import { loadPrompt } from "@/llm/prompts";
import { serviceByKey, serviceForPackage } from "@/lib/services";
import type { OsvRange } from "@/sources/osv";
import { runtimeEvidence, UNKNOWN_IMAGE } from "@scan/runtimes";
import { runtimeVersionLabel } from "@/lib/runtime-range";
import type { Logger } from "@/lib/log";
import type { JobContext, JobResult } from "@/worker/types";

import {
  assembleBulletin,
  itemUpgrades,
  buildSynthesisInput,
  bulletinSubject,
  candidateFromMatch,
  countMinor,
  minorRows,
  foldReleases,
  isoWeekLabel,
  selectCandidates,
  subjectTopic,
  summariseAlerts,
  SYNTHESIS_JSON_SCHEMA,
  synthesisInputHash,
  synthesisOutputSchema,
  weekStartOf,
  type Candidate,
  type MinorRow,
  type SecurityAlertSummary,
  type SelectedCandidate,
  type StackRepo,
  type SynthesisInput,
  type SynthesisOutput,
} from "./bulletin";
import type { RepoFix } from "./fixes";
import type { RuntimeRow } from "./runtime-fixes";
import type { RepoInstall } from "./upgrades";

import { smtpConfig } from "@/lib/email/mailer";
import { asEcosystem, asPackageManager } from "@scan/ecosystems";

import { deliverBulletin } from "./deliver";
import { refreshProfile } from "./profile";
import { pseudonymiseSynthesisInput, restoreSynthesisOutput } from "./synthesis-privacy";
import { parseWeights } from "./weights";

const WINDOW_DAYS = 7;

async function loadCandidates(
  db: PrismaClient,
  orgId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<Candidate[]> {
  const rows = await withOrg(db, orgId).itemMatch.findMany({
    where: { item: { triage: { createdAt: { gte: periodStart, lt: periodEnd } } } },
    select: {
      score: true,
      reason: true,
      repoIds: true,
      package: { select: { name: true, ecosystem: true, actionTags: true } },
      service: { select: { key: true } },
      item: {
        select: {
          id: true,
          contentHash: true,
          title: true,
          url: true,
          rawText: true,
          publishedAt: true,
          metadata: true,
          source: { select: { name: true, kind: true } },
          triage: { select: { bucket: true, packages: true, dueAt: true, dueWhat: true } },
        },
      },
    },
  });
  return rows.flatMap((r) => {
    const c = candidateFromMatch({
      score: r.score,
      reason: r.reason,
      repoIds: r.repoIds,
      packageName: r.package?.name ?? null,
      packageEcosystem: r.package?.ecosystem ?? null,
      serviceKey: r.service?.key ?? null,
      item: {
        ...r.item,
        sourceName: r.item.source.name,
        sourceKind: r.item.source.kind,
      },
    });
    return c ? [c] : [];
  });
}

/** The stream's repos, their direct packages and runtimes, and the traits their services imply. */
async function loadStack(
  db: PrismaClient,
  orgId: string,
  repoIds: string[]
): Promise<{
  repos: Map<string, string>;
  stack: StackRepo[];
  traits: Set<string>;
  runtimes: Map<string, (RuntimeRow & { repoId: string })[]>;
}> {
  const scoped = withOrg(db, orgId);
  const traits = new Set<string>();
  const repos = await scoped.repo.findMany({
    where: { id: { in: repoIds } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      dependencies: {
        where: { direct: true },
        orderBy: { package: { name: "asc" } },
        select: {
          installedVersion: true,
          dev: true,
          group: true,
          requirement: true,
          project: true,
          manager: true,
          unresolved: true,
          package: { select: { name: true, ecosystem: true, actionTags: true } },
        },
      },
      runtimes: {
        where: { name: { not: UNKNOWN_IMAGE } },
        orderBy: [{ name: "asc" }, { source: "asc" }],
        select: {
          name: true,
          version: true,
          normalized: true,
          source: true,
          unresolved: true,
          image: true,
          constraint: true,
        },
      },
    },
  });
  const runtimes = new Map<string, (RuntimeRow & { repoId: string })[]>();
  for (const r of repos) {
    for (const rt of r.runtimes) {
      runtimes.set(rt.name, [
        ...(runtimes.get(rt.name) ?? []),
        { ...rt, repo: r.name, repoId: r.id },
      ]);
    }
  }
  return {
    runtimes,
    repos: new Map(repos.map((r) => [r.id, r.name])),
    stack: repos.map((r) => {
      const services = new Set<string>();
      for (const d of r.dependencies) {
        const key = serviceForPackage(d.package.name)?.key;
        if (!key) continue;
        const definition = serviceByKey(key);
        services.add(definition?.name ?? key);
        for (const trait of definition?.traits ?? []) traits.add(trait);
      }
      return {
        name: r.name,
        dependencies: r.dependencies.map((d) => {
          const ecosystem = asEcosystem(d.package.ecosystem);
          const manager = asPackageManager(d.manager);
          return {
            name: d.package.name,
            actionTags: storedActionTags(d.package.actionTags),
            version: d.installedVersion,
            ...(ecosystem && ecosystem !== "npm" ? { ecosystem } : {}),
            ...(d.dev ? { dev: true as const } : {}),
            ...(d.group ? { group: d.group } : {}),
            ...(d.requirement ? { requirement: d.requirement } : {}),
            ...(d.project ? { project: d.project } : {}),
            ...(manager ? { manager } : {}),
            ...(d.unresolved ? { unresolved: true as const } : {}),
          };
        }),
        services: [...services].sort(),
        // What the repo runs, as the EOL checks see it: concrete rows over engines ranges,
        // and a range in its readable form (`20+`), so the model never reads ">=20" as node 20.
        runtimes: [...new Set(r.runtimes.map((rt) => rt.name))]
          .flatMap((name) => runtimeEvidence(r.runtimes.filter((rt) => rt.name === name)))
          .map((rt) => ({ name: rt.name, version: runtimeVersionLabel(rt) })),
      };
    }),
    traits,
  };
}

interface StreamAlerts {
  /** New advisories of the period (backlog left out): the synthesis input. */
  summaries: SecurityAlertSummary[];
  /** Advisories of the period from a first scan (listed on the page, not in the input). */
  backlogAdvisories: number;
  /**
   * Package -> one entry per (repo, advisory, affected installed version): the resolved fix
   * and whether the repo has it directly. Backlog counts too: an installed version at risk
   * makes a security item must-act whatever scan found it.
   */
  repoFixes: Map<string, RepoFix[]>;
  /**
   * Package -> repo -> installed versions, for every stream repo that has a package of
   * `repoFixes` (with or without an alert): an affected repo is listed with what it runs.
   */
  installs: Map<string, Map<string, RepoInstall[]>>;
}

async function loadAlerts(
  db: PrismaClient,
  orgId: string,
  start: Date,
  end: Date,
  repoIds: string[]
): Promise<StreamAlerts> {
  const scoped = withOrg(db, orgId);
  const rows = await scoped.alert.findMany({
    where: { createdAt: { gte: start, lt: end }, repoId: { in: repoIds } },
    select: {
      repoId: true,
      kind: true,
      repo: { select: { name: true } },
      advisory: {
        select: {
          osvId: true,
          severity: true,
          affected: true,
          package: { select: { id: true, name: true, ecosystem: true } },
        },
      },
    },
  });
  // Advisory.fixedVersion lists every fixed event; resolve the fix per installed version instead.
  // Every stream repo, not only the alerted ones: an item's other affected repos are listed too.
  const deps =
    rows.length > 0
      ? await scoped.dependency.findMany({
          where: {
            repoId: { in: repoIds },
            packageId: { in: [...new Set(rows.map((r) => r.advisory.package.id))] },
            unresolved: false,
          },
          select: {
            repoId: true,
            packageId: true,
            installedVersion: true,
            direct: true,
            dev: true,
            group: true,
            requirement: true,
            project: true,
            manager: true,
            repo: { select: { name: true } },
            package: { select: { name: true, ecosystem: true, actionTags: true } },
          },
        })
      : [];
  const installed = new Map<string, RepoInstall[]>();
  const installs = new Map<string, Map<string, RepoInstall[]>>();
  for (const d of deps) {
    const manager = asPackageManager(d.manager);
    const install = {
      actionTags: storedActionTags(d.package.actionTags),
      version: d.installedVersion,
      direct: d.direct,
      ...(d.dev ? { dev: true } : {}),
      ...(d.group ? { group: d.group } : {}),
      ...(d.requirement ? { requirement: d.requirement } : {}),
      ...(d.project ? { project: d.project } : {}),
      ...(manager ? { manager } : {}),
      ...(d.package.ecosystem !== "npm" ? { ecosystem: d.package.ecosystem } : {}),
    };
    const key = `${d.repoId}:${d.packageId}`;
    installed.set(key, [...(installed.get(key) ?? []), install]);
    const byRepo = installs.get(d.package.name) ?? new Map<string, RepoInstall[]>();
    byRepo.set(d.repo.name, [...(byRepo.get(d.repo.name) ?? []), install]);
    installs.set(d.package.name, byRepo);
  }
  const { summaries, repoFixes } = summariseAlerts(
    rows.map((r) => ({
      kind: r.kind,
      repo: r.repo.name,
      osvId: r.advisory.osvId,
      severity: r.advisory.severity,
      affected: r.advisory.affected as unknown as OsvRange[],
      packageName: r.advisory.package.name,
      ecosystem: asEcosystem(r.advisory.package.ecosystem),
      installed: installed.get(`${r.repoId}:${r.advisory.package.id}`) ?? [],
    }))
  );
  return {
    summaries,
    backlogAdvisories: new Set(
      rows.filter((r) => r.kind === "backlog").map((r) => r.advisory.osvId)
    ).size,
    repoFixes,
    installs,
  };
}

export interface StreamRef {
  id: string;
  name: string;
  repoIds: string[];
}

export interface SynthesisContext {
  now: Date;
  weekStart: Date;
  week: string;
  language: Language;
  model: string;
  promptVersion: string;
}

/** Everything a stream's synthesis and its stored bulletin need, computed before the LLM call. */
export interface PreparedStream {
  orgId: string;
  stream: StreamRef;
  periodStart: Date;
  periodEnd: Date;
  selected: SelectedCandidate[];
  minorCount: number;
  /** The minor items behind `minorCount` (capped), listed when the folded-away bar opens. */
  minor: MinorRow[];
  eolFacts?: string[];
  alertPackages: ReadonlySet<string>;
  /** The stream's repos with their direct dependencies (installed versions for itemUpgrades). */
  stack: StackRepo[];
  /** Every repo name of the org, aliased in the request (the profile text is org-wide). */
  orgRepoNames: string[];
  privateActionNames?: string[];
  input: SynthesisInput;
  inputHash: string;
  /** Length of the JSON the model receives (tracks the input shrink next to the token count). */
  inputChars: number;
  candidates: number;
}

/**
 * Selection and synthesis input for one stream and the current week. The period
 * starts where the stream's previous bulletin ended.
 * Null when there is nothing to report.
 */
export async function prepareStream(
  db: PrismaClient,
  orgId: string,
  stream: StreamRef,
  ctx: SynthesisContext
): Promise<PreparedStream | null> {
  const scoped = withOrg(db, orgId);
  const previous = await scoped.bulletin.findFirst({
    where: { streamId: stream.id, preview: false, weekStart: { lt: ctx.weekStart } },
    orderBy: { weekStart: "desc" },
    select: { periodEnd: true },
  });
  const periodStart = previous?.periodEnd ?? new Date(ctx.now.getTime() - WINDOW_DAYS * 86_400_000);
  const periodEnd = ctx.now;

  const [candidates, { repos, stack, traits, runtimes }, alerts, profile, orgRepos, actionDeps] =
    await Promise.all([
      loadCandidates(db, orgId, periodStart, periodEnd),
      loadStack(db, orgId, stream.repoIds),
      loadAlerts(db, orgId, periodStart, periodEnd, stream.repoIds),
      scoped.interestProfile.findFirst({ select: { text: true, weights: true } }),
      scoped.repo.findMany({ select: { name: true } }),
      scoped.dependency.findMany({
        where: { package: { ecosystem: "GitHub Actions" } },
        distinct: ["packageId"],
        select: { package: { select: { name: true } } },
      }),
    ]);
  const weights = parseWeights(profile?.weights);
  const t = strings(ctx.language);
  // Minor releases folded under a non-minor release of the same package are no longer minor.
  const folded = foldReleases(candidates);
  const selected = selectCandidates(folded, repos, weights, {
    now: ctx.now,
    alertFixes: alerts.repoFixes,
    alertInstalls: alerts.installs,
    transitiveAction: t.act_transitive,
    traits,
    runtimes,
  });
  const minorCount = countMinor(folded, repos, traits);
  const minor = minorRows(folded, repos, traits);
  const { facts: eolFacts } = upcomingEol([...runtimes.values()].flat(), ctx.now);
  // A first-scan backlog alone still gets a bulletin: its page is where the backlog is listed.
  const baseImages = await loadBaseImageGroups(
    db,
    orgId,
    { id: { in: stream.repoIds } },
    { gte: periodStart, lt: periodEnd }
  );
  if (
    selected.length === 0 &&
    alerts.summaries.length === 0 &&
    alerts.backlogAdvisories === 0 &&
    eolFacts.length === 0 &&
    baseImages.length === 0
  )
    return null;

  const input = buildSynthesisInput({
    language: ctx.language,
    week: ctx.week,
    profileText: profile?.text ?? "",
    weights,
    stack,
    selected,
    minorCount,
    alerts: alerts.summaries,
  });
  const synthesisHash = synthesisInputHash(
    ctx.model,
    ctx.promptVersion,
    input,
    selected,
    stream.id
  );
  return {
    orgId,
    stream,
    periodStart,
    periodEnd,
    selected,
    minorCount,
    minor,
    eolFacts,
    alertPackages: new Set(alerts.repoFixes.keys()),
    stack,
    orgRepoNames: orgRepos.map((r) => r.name),
    privateActionNames: actionDeps.map((d) => d.package.name),
    input,
    inputHash: baseImages.length
      ? createHash("sha256").update(synthesisHash).update(JSON.stringify(baseImages)).digest("hex")
      : synthesisHash,
    inputChars: JSON.stringify(input).length,
    candidates: candidates.length,
  };
}

export function synthesisRequest(
  prepared: PreparedStream,
  model: string,
  system: string
): JsonRequest<SynthesisOutput> {
  // Repo names leave as per-request aliases; the parsed output gets them back.
  const { input, aliases } = pseudonymiseSynthesisInput(
    prepared.input,
    prepared.orgRepoNames,
    // Actions repository names remain private at the model boundary.
    prepared.stack.flatMap((r) => r.dependencies.map((d) => d.name)),
    prepared.privateActionNames
  );
  return {
    task: "synthesis",
    model,
    system,
    user: JSON.stringify(input),
    schema: SYNTHESIS_JSON_SCHEMA,
    parse: (v) => restoreSynthesisOutput(synthesisOutputSchema.parse(v), aliases),
    maxTokens: 16000,
    effort: "medium",
  };
}

// Minor rows sort after every synthesised item.
const MINOR_ORDER_BASE = 10_000;

/** BulletinItem rows for a bulletin's minor items (bucket `minor`, section `rest`). */
function minorItemData(
  orgId: string,
  bulletinId: string,
  minor: readonly MinorRow[]
): Prisma.BulletinItemCreateManyInput[] {
  return minor.map((m, i) => ({
    orgId,
    bulletinId,
    itemId: m.itemId,
    bucket: "minor" as const,
    section: "rest" as const,
    order: MINOR_ORDER_BASE + i,
    line: m.line,
    affectedRepos: m.affectedRepos as Prisma.InputJsonValue,
  }));
}

/**
 * Rewrites only the minor rows of a bulletin whose synthesis input did not change: the
 * count is part of that input, the listed items are not.
 */
async function replaceMinorItems(
  db: PrismaClient,
  orgId: string,
  bulletinId: string,
  minor: readonly MinorRow[]
): Promise<void> {
  await withOrg(db, orgId).$transaction(async (tx) => {
    await tx.bulletinItem.deleteMany({ where: { bulletinId, bucket: "minor" } });
    if (minor.length > 0)
      await tx.bulletinItem.createMany({ data: minorItemData(orgId, bulletinId, minor) });
  });
}

/** Assembles the model output and upserts the week's Bulletin and its items for the stream. */
export async function storeBulletin(
  db: PrismaClient,
  prepared: PreparedStream,
  res: JsonResponse<SynthesisOutput>,
  ctx: SynthesisContext,
  log?: Logger
): Promise<{ bulletinId: string; dropped: number; restItems: number; refMismatch: number }> {
  const { orgId, stream, selected } = prepared;
  const t = strings(ctx.language);
  const assembled = assembleBulletin(
    res.data,
    selected,
    (c) => {
      const pkg = c.keys.packages.find((p) => prepared.alertPackages.has(p));
      return pkg ? t.act_fallback_security(pkg) : t.act_fallback;
    },
    t.line_also_affected
  );
  for (const m of assembled.refMismatches) {
    log?.warn(
      { orgId, streamId: stream.id, itemId: m.itemId, modelText: m.text },
      "bulletin: model text does not name its ref, using the item title"
    );
  }
  const byId = new Map(selected.map((c) => [c.itemId, c]));
  const upgradesOf = (i: (typeof assembled.items)[number]) => {
    const c = byId.get(i.itemId);
    return c ? itemUpgrades(i, c, prepared.stack) : [];
  };
  const subject = bulletinSubject(
    stream.name,
    ctx.week,
    assembled.items.flatMap((i) => {
      const c = byId.get(i.itemId);
      return i.section === "act" && c ? [subjectTopic(c, i.headline)] : [];
    })
  );
  const data = {
    periodStart: prepared.periodStart,
    periodEnd: prepared.periodEnd,
    language: ctx.language,
    model: res.model,
    promptVersion: ctx.promptVersion,
    subject,
    summary: [assembled.summary, ...(prepared.eolFacts ?? [])].filter(Boolean).join("\n\n"),
    minorCount: prepared.minorCount,
    inputHash: prepared.inputHash,
    emailStatus: "pending" as const,
    emailError: null,
    emailSentAt: null,
  };
  const scoped = withOrg(db, orgId);
  const bulletinId = await scoped.$transaction(async (tx) => {
    const existing = await tx.bulletin.findFirst({
      where: { streamId: stream.id, weekStart: ctx.weekStart, previewKey: "" },
      select: { id: true },
    });
    const saved = existing
      ? await tx.bulletin.update({ where: { id: existing.id }, data, select: { id: true } })
      : await tx.bulletin.create({
          data: {
            orgId,
            streamId: stream.id,
            weekStart: ctx.weekStart,
            ...data,
          },
          select: { id: true },
        });
    await tx.bulletinItem.deleteMany({ where: { bulletinId: saved.id } });
    if (assembled.items.length > 0) {
      await tx.bulletinItem.createMany({
        data: assembled.items.map((i) => ({
          orgId,
          bulletinId: saved.id,
          itemId: i.itemId,
          bucket: i.bucket,
          section: i.section,
          order: i.order,
          headline: i.headline,
          line: i.line,
          action: i.action,
          todo: i.todo,
          affectedRepos: i.affectedRepos as Prisma.InputJsonValue,
          foldedItemIds: i.foldedItemIds as Prisma.InputJsonValue,
          upgrades: upgradesOf(i) as unknown as Prisma.InputJsonValue,
        })),
      });
    }
    if (prepared.minor.length > 0) {
      await tx.bulletinItem.createMany({
        data: minorItemData(orgId, saved.id, prepared.minor),
      });
    }
    return saved.id;
  });
  return {
    bulletinId,
    dropped: selected.length - assembled.items.length,
    restItems: assembled.items.filter((i) => i.section === "rest").length,
    refMismatch: assembled.refMismatches.length,
  };
}

async function streamsOf(db: PrismaClient, orgId: string): Promise<StreamRef[]> {
  const rows = await withOrg(db, orgId).bulletinStream.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, repos: { select: { repoId: true } } },
  });
  return rows.map((s) => ({ id: s.id, name: s.name, repoIds: s.repos.map((r) => r.repoId) }));
}

/**
 * weekly-bulletin (plan §7.6–7.8): refresh each org's profile, prepare every
 * stream with repos, send all synthesis requests whose input changed as one
 * Message Batch, then store one Bulletin per (stream, week) and deliver it by email.
 */
export async function weeklyBulletin({ db, log, heartbeat }: JobContext): Promise<JobResult> {
  const env = getEnv();
  const counts = {
    orgs: 0,
    streams: 0,
    streamsWithoutRepos: 0,
    streamErrors: 0,
    generated: 0,
    unchanged: 0,
    empty: 0,
    candidates: 0,
    selected: 0,
    dropped: 0,
    restItems: 0,
    refMismatch: 0,
    synthesisRequests: 0,
    inputChars: 0,
    profilesRefreshed: 0,
    emailsSent: 0,
    emailsFailed: 0,
    llmUnavailable: 0,
    errors: 0,
  };
  const meter = new TokenMeter();
  const llm = getLlm();
  if (!llm.ok) {
    counts.llmUnavailable = 1;
    log.warn({ reason: llm.reason }, "bulletin: LLM unavailable, skipping");
    return { counts };
  }
  const client = llm.client;
  const prompt = loadPrompt("synthesis");
  const now = new Date();
  const ctx: SynthesisContext = {
    now,
    weekStart: weekStartOf(now),
    week: isoWeekLabel(now),
    language: PRODUCT_LANGUAGE,
    model: env.BRIFF_MODEL_SYNTHESIS,
    promptVersion: prompt.version,
  };

  const toSynthesise: PreparedStream[] = [];
  const toRedeliver: { orgId: string; bulletinId: string }[] = [];

  const orgs = await db.org.findMany({ select: { id: true } });
  for (const org of orgs) {
    counts.orgs++;
    try {
      await prepareOrg(org.id);
    } catch (err) {
      counts.errors++;
      log.error({ err, orgId: org.id }, "bulletin: org failed");
    }
  }

  const { entries, batch: billedAsBatch } = await jsonMany(
    client,
    toSynthesise.map((p) => synthesisRequest(p, ctx.model, prompt.text)),
    { batch: llm.batch, onPoll: heartbeat }
  );
  for (const [index, entry] of entries.entries()) {
    const prepared = toSynthesise[index];
    const where = { orgId: prepared.orgId, streamId: prepared.stream.id };
    if (!entry.ok) {
      counts.streamErrors++;
      log.error({ err: entry.error, ...where }, "bulletin: synthesis failed");
      continue;
    }
    meter.add("synthesis", entry.response.model, entry.response.usage, {
      batch: llm.batch ? billedAsBatch : undefined,
    });
    try {
      const stored = await storeBulletin(db, prepared, entry.response, ctx, log);
      counts.generated++;
      counts.dropped += stored.dropped;
      counts.restItems += stored.restItems;
      counts.refMismatch += stored.refMismatch;
      await deliver(prepared.orgId, stored.bulletinId, log);
    } catch (err) {
      counts.streamErrors++;
      log.error({ err, ...where }, "bulletin: store or delivery failed");
    }
  }
  for (const r of toRedeliver) {
    try {
      await deliver(r.orgId, r.bulletinId, log);
    } catch (err) {
      counts.streamErrors++;
      log.error({ err, ...r }, "bulletin: delivery failed");
    }
  }

  const failedOrgs = counts.orgs > 0 && counts.errors === counts.orgs;
  const failedStreams = counts.streams > 0 && counts.streamErrors === counts.streams;
  if (failedOrgs || failedStreams) {
    throw new Error(
      failedOrgs
        ? `bulletin failed for all ${counts.orgs} orgs`
        : `bulletin failed for all ${counts.streams} streams`
    );
  }

  log.info(counts, "bulletin: done");
  return { counts, tokens: meter.toJSON() };

  async function deliver(orgId: string, bulletinId: string, logger: Logger): Promise<void> {
    const delivered = await deliverBulletin(db, orgId, bulletinId, logger);
    counts.emailsSent += delivered.emailsSent;
    counts.emailsFailed += delivered.emailsFailed;
  }

  async function prepareOrg(orgId: string): Promise<void> {
    try {
      if (
        (await refreshProfile({
          db,
          llm: client,
          model: env.BRIFF_MODEL_TRIAGE,
          orgId,
          language: ctx.language,
          meter,
          log,
        })) === "refreshed"
      ) {
        counts.profilesRefreshed++;
      }
    } catch (err) {
      log.warn({ err, orgId }, "bulletin: profile refresh failed, using the stored profile");
    }

    for (const stream of await streamsOf(db, orgId)) {
      if (stream.repoIds.length === 0) {
        counts.streamsWithoutRepos++;
        continue;
      }
      counts.streams++;
      try {
        await prepareWeekly(orgId, stream);
      } catch (err) {
        counts.streamErrors++;
        log.error({ err, orgId, streamId: stream.id }, "bulletin: stream failed");
      }
    }
  }

  async function prepareWeekly(orgId: string, stream: StreamRef): Promise<void> {
    const prepared = await prepareStream(db, orgId, stream, ctx);
    if (!prepared) {
      counts.empty++;
      log.info({ orgId, streamId: stream.id }, "bulletin: nothing to report");
      return;
    }
    counts.candidates += prepared.candidates;
    counts.selected += prepared.selected.length;
    const existing = await withOrg(db, orgId).bulletin.findFirst({
      where: { streamId: stream.id, weekStart: ctx.weekStart, previewKey: "" },
      select: { id: true, inputHash: true, emailStatus: true },
    });
    if (existing && existing.inputHash === prepared.inputHash) {
      counts.unchanged++;
      await replaceMinorItems(db, orgId, existing.id, prepared.minor);
      const retryEmail =
        existing.emailStatus === "pending" ||
        existing.emailStatus === "failed" ||
        (existing.emailStatus === "skipped" && smtpConfig() !== null);
      if (retryEmail) toRedeliver.push({ orgId, bulletinId: existing.id });
      return;
    }
    counts.synthesisRequests++;
    counts.inputChars += prepared.inputChars;
    log.info(
      {
        orgId,
        streamId: stream.id,
        items: prepared.selected.length,
        inputChars: prepared.inputChars,
      },
      "bulletin: synthesis queued"
    );
    toSynthesise.push(prepared);
  }
}
