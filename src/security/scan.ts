import type { Prisma } from "@/generated/prisma/client";
import { mapLimit } from "@/lib/concurrency";
import { withOrg } from "@/lib/db/with-org";
import { renderSecurityAlertEmail, type FirstScanSummary } from "@/lib/email/alert-email";
import { sendMail, smtpConfig } from "@/lib/email/mailer";
import { orgRecipients } from "@/lib/email/recipients";
import { getEnv } from "@/lib/env";
import { fetchOsvVuln, queryOsvBatchHits, type OsvRange, type OsvVuln } from "@/sources/osv";
import type { JobContext, JobResult } from "@/worker/types";
import { ECOSYSTEMS, isEcosystem, type Ecosystem } from "@scan/ecosystems";

import { storedActionTags } from "@/sources/github-actions";

import { aliasGroups, byIdRank, idsOf, mergeAliasGroup } from "./aliases";
import {
  alertKey,
  alertKindFor,
  backlogSummary,
  newAlertCandidates,
  planAlertMerge,
  planQueries,
  splitPending,
  type AlertGroup,
  type StackDependency,
} from "./plan";

import { publicActionsForScan } from "./action-visibility";

const FETCH_CONCURRENCY = 8;
/** Advisories without covered packages refetched per run, on top of the ones OSV answered with. */
const COVERAGE_BACKFILL_LIMIT = 500;

interface Wanted {
  modified: string | null;
  packageId: string;
  packageName: string;
  ecosystem: Ecosystem;
}

interface StoredAdvisory {
  id: string;
  osvId: string;
  aliases: string[] | null;
  recordsModified: Record<string, unknown> | null;
  /** Stored before covered packages were recorded: refetched once. */
  packagesMissing: boolean;
}

type ScanCounts = Record<
  "advisoriesFetched" | "advisoryFetchErrors" | "advisoriesMerged" | "alertsMerged",
  number
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((v) => typeof v === "string") ? value : null;
}

/**
 * Brings the Advisory table up to date for the ids OSV answered with and says which row
 * each id belongs to. Ids of one vulnerability (GHSA, GO- or PYSEC- record, CVE) share one row,
 * under the canonical id (aliases.ts). A row is refetched, together with every id that
 * points to it, when OSV moved `modified` past the stored one, or when it was stored before
 * aliases were collapsed (`aliases` null). Rows that turn out to hold the same vulnerability
 * as another are returned in `merges` (duplicate row id -> canonical row id).
 */
async function storeAdvisories(
  { db, log, heartbeat }: Pick<JobContext, "db" | "log" | "heartbeat">,
  wanted: ReadonlyMap<string, Wanted>,
  counts: ScanCounts
): Promise<{
  advisoryOf: (osvId: string) => string | undefined;
  merges: Map<string, string>;
  withdrawn: Set<string>;
}> {
  const rowOf = new Map<string, StoredAdvisory>();
  const looked = new Set<string>();
  /** Loads the stored rows holding any of `ids`, as their own id or as an alias. */
  const loadRows = async (ids: readonly string[]): Promise<StoredAdvisory[]> => {
    const fresh = [...new Set(ids)].filter((id) => !looked.has(id));
    for (const id of fresh) looked.add(id);
    if (fresh.length === 0) return [];
    // Advisory is a global catalog table (no tenant data), read raw for the jsonb `?|` match.
    const rows = await db.$queryRaw<
      {
        id: string;
        osvId: string;
        aliases: unknown;
        recordsModified: unknown;
        packagesMissing: boolean;
      }[]
    >`
      SELECT "id", "osvId", "aliases", "recordsModified", ("packages" IS NULL) AS "packagesMissing"
      FROM "advisory"
      WHERE "osvId" = ANY(${fresh}::text[]) OR "aliases" ?| ${fresh}::text[]`;
    const known = new Map([...rowOf.values()].map((r) => [r.id, r]));
    const loaded = rows.map(
      (r) =>
        known.get(r.id) ?? {
          ...r,
          aliases: stringList(r.aliases),
          recordsModified: isRecord(r.recordsModified) ? r.recordsModified : null,
        }
    );
    for (const row of loaded) if (!rowOf.has(row.osvId)) rowOf.set(row.osvId, row);
    for (const row of loaded) {
      for (const alias of row.aliases ?? []) if (!rowOf.has(alias)) rowOf.set(alias, row);
    }
    return loaded;
  };
  await loadRows([...wanted.keys()]);

  // Each record against its own stored `modified`: aliases change on their own schedules
  // (GHSA-2c4m-59x9-fr2g last moved in 2023, its GO-2023-1737 in 2024).
  const stale = (id: string, hit: Wanted): boolean => {
    const row = rowOf.get(id);
    if (!row || row.aliases === null || row.recordsModified === null || row.packagesMissing)
      return true;
    const known = row.recordsModified[id];
    if (typeof known !== "string") return true;
    return hit.modified !== null && new Date(hit.modified) > new Date(known);
  };
  const refresh = new Set<StoredAdvisory>();
  let toFetch = new Set<string>();
  for (const [id, hit] of wanted) {
    if (!stale(id, hit)) continue;
    toFetch.add(id);
    const row = rowOf.get(id);
    if (row) refresh.add(row);
  }
  /** A refreshed row is refetched whole: its own record and every id that points to it. */
  const wholeRows = (rows: Iterable<StoredAdvisory>): string[] => {
    const set = new Set(rows);
    return [
      ...[...set].map((r) => r.osvId),
      ...[...wanted.keys()].filter((id) => {
        const row = rowOf.get(id);
        return row !== undefined && set.has(row);
      }),
    ];
  };
  for (const id of wholeRows(refresh)) toFetch.add(id);

  const fetched: OsvVuln[] = [];
  const withdrawn = new Set<string>();
  const failed = new Set<string>();
  const attempted = new Set<string>();
  let done = 0;
  // A fetched record can point to stored rows nothing else refreshed (a new GO-* naming an
  // unchanged GHSA): those are refetched too, so the group is merged from all its records.
  // A few rounds cover any alias chain; ids still pending after them count as failed.
  for (let round = 0; toFetch.size > 0; round++) {
    const batch = [...toFetch].filter((id) => !attempted.has(id));
    toFetch = new Set();
    if (round === 3) {
      for (const id of batch) failed.add(id);
      break;
    }
    for (const id of batch) attempted.add(id);
    const got: OsvVuln[] = [];
    await mapLimit(batch, FETCH_CONCURRENCY, async (osvId) => {
      try {
        const vuln = await fetchOsvVuln(osvId);
        if (vuln.withdrawn) withdrawn.add(osvId);
        else got.push(vuln);
        counts.advisoriesFetched++;
      } catch (err) {
        failed.add(osvId);
        counts.advisoryFetchErrors++;
        log.warn({ err, osvId }, "security: advisory fetch failed");
      }
      // The first scan after the aliases migration refetches every stored advisory.
      if (++done % 100 === 0) await heartbeat();
    });
    fetched.push(...got);
    await loadRows(got.flatMap(idsOf));
    const reached = new Set(
      got.flatMap(idsOf).flatMap((id) => {
        const row = rowOf.get(id);
        return row && !refresh.has(row) ? [row] : [];
      })
    );
    for (const row of reached) refresh.add(row);
    for (const id of wholeRows(reached)) if (!attempted.has(id)) toFetch.add(id);
  }
  fetched.sort((a, b) => a.id.localeCompare(b.id));

  const resolved = new Map<string, string>();
  const merges = new Map<string, string>();
  const claimed = new Set<StoredAdvisory>();
  for (const group of aliasGroups(fetched)) {
    const hit = group.map((v) => wanted.get(v.id)).find((h) => h !== undefined);
    if (!hit) continue;
    const { aliases, recordsModified, ...fields } = mergeAliasGroup(
      group,
      hit.packageName,
      hit.ecosystem
    );
    const ids = [fields.osvId, ...aliases];
    const touched = [
      ...new Set(
        ids.flatMap((id) => {
          const row = rowOf.get(id);
          return row && !claimed.has(row) ? [row] : [];
        })
      ),
    ].sort((a, b) => byIdRank(a.osvId, b.osvId));
    // A group with a record that failed to fetch is incomplete: written now it could lose
    // the missing record's id, level or fixes (a GO-* without its GHSA has no severity).
    // Its stored rows stay as they are and are retried next run (still stale).
    const touchedRows = new Set(touched);
    if (
      ids.some((id) => failed.has(id)) ||
      [...failed].some((id) => {
        const row = rowOf.get(id);
        return row !== undefined && touchedRows.has(row);
      })
    ) {
      for (const row of touched) claimed.add(row);
      continue;
    }
    // The row already under the canonical id, else the best one, renamed: its alerts stay.
    const target = touched.find((r) => r.osvId === fields.osvId) ?? touched[0];
    const data = {
      ...fields,
      affected: fields.affected as unknown as Prisma.InputJsonValue,
      packages: fields.packages as unknown as Prisma.InputJsonValue,
      aliases,
      recordsModified,
    };
    try {
      const row = target
        ? await db.advisory.update({ where: { id: target.id }, data, select: { id: true } })
        : await db.advisory.create({
            data: { ...data, packageId: hit.packageId },
            select: { id: true },
          });
      for (const dup of touched) {
        claimed.add(dup);
        if (dup !== target) merges.set(dup.id, row.id);
      }
      for (const id of ids) resolved.set(id, row.id);
    } catch (err) {
      counts.advisoryFetchErrors++;
      log.warn({ err, osvId: fields.osvId }, "security: advisory store failed");
    }
  }

  const advisoryOf = (osvId: string): string | undefined => {
    const id = resolved.get(osvId);
    if (id) return id;
    if (withdrawn.has(osvId)) return undefined;
    // Not refetched (unchanged, or the fetch failed): the stored row it points to.
    const row = rowOf.get(osvId);
    return row ? (merges.get(row.id) ?? row.id) : undefined;
  };
  return { advisoryOf, merges, withdrawn };
}

/**
 * Folds the alerts of duplicate advisories onto the canonical one, per org, then deletes the
 * duplicates. Delivery state carries over (planAlertMerge), so nothing is emailed again.
 */
async function mergeDuplicates(
  db: JobContext["db"],
  orgs: readonly { id: string }[],
  merges: ReadonlyMap<string, string>,
  counts: ScanCounts
): Promise<void> {
  const advisoryIds = [...new Set([...merges.keys(), ...merges.values()])];
  for (const org of orgs) {
    await withOrg(db, org.id).$transaction(async (tx) => {
      const alerts = await tx.alert.findMany({
        where: { advisoryId: { in: advisoryIds } },
        select: {
          id: true,
          advisoryId: true,
          repoId: true,
          kind: true,
          deliveredAt: true,
          reviewedAt: true,
          createdAt: true,
        },
      });
      const plan = planAlertMerge(alerts, merges);
      if (plan.deleteIds.length > 0) {
        await tx.alert.deleteMany({ where: { id: { in: plan.deleteIds } } });
      }
      for (const { id, ...data } of plan.updates) {
        await tx.alert.updateMany({ where: { id }, data });
      }
      counts.alertsMerged += plan.deleteIds.length;
    });
  }
  // Every alert has left them; the cascade has nothing left to delete.
  const removed = await db.advisory.deleteMany({ where: { id: { in: [...merges.keys()] } } });
  counts.advisoriesMerged += removed.count;
}

/**
 * security-scan (plan §7.4, no LLM): installed versions of every included repo
 * (direct and transitive) are checked against OSV; new (advisory × repo) pairs
 * become Alerts, `backlog` on a repo's first scan and `new` afterwards. One email per
 * org (per recipient) per run carries the new critical/high alerts and, after a first
 * scan, one summary of the backlog. Moderate and low alerts wait for the bulletin.
 */
export async function securityScan({ db, log, heartbeat }: JobContext): Promise<JobResult> {
  const startedAt = new Date();
  const counts = {
    orgs: 0,
    reposIncluded: 0,
    reposSkipped: 0,
    queries: 0,
    vulnerableQueries: 0,
    advisoriesFetched: 0,
    advisoryFetchErrors: 0,
    advisoriesMerged: 0,
    alertsMerged: 0,
    alertsNew: 0,
    alertsBacklog: 0,
    alertsDelivered: 0,
    alertsHeld: 0,
    alertsReopened: 0,
    advisoriesBackfilled: 0,
    emailsSent: 0,
    emailsFailed: 0,
  };

  const orgs = await db.org.findMany({ select: { id: true, name: true } });
  counts.orgs = orgs.length;
  const deps: StackDependency[] = [];
  const repoState = new Map<
    string,
    { securityScannedAt: Date | null; includedChangedAt: Date | null }
  >();
  for (const org of orgs) {
    const scoped = withOrg(db, org.id);
    const repos = await scoped.repo.findMany({
      select: {
        id: true,
        name: true,
        included: true,
        securityScannedAt: true,
        includedChangedAt: true,
      },
    });
    for (const r of repos) repoState.set(r.id, r);
    counts.reposIncluded += repos.filter((r) => r.included).length;
    counts.reposSkipped += repos.filter((r) => !r.included).length;
    const rows = await scoped.dependency.findMany({
      // Every ecosystem OSV is queried for; each package is queried in its own one.
      // An unresolved row holds a requirement (`>=2.0`), not a version OSV can place.
      where: {
        repo: { included: true },
        unresolved: false,
        package: { ecosystem: { in: [...ECOSYSTEMS] } },
      },
      select: {
        repoId: true,
        constraint: true,
        installedVersion: true,
        direct: true,
        repo: { select: { name: true } },
        package: { select: { id: true, name: true, ecosystem: true } },
      },
    });
    for (const row of rows) {
      if (!isEcosystem(row.package.ecosystem)) continue;
      deps.push({
        ecosystem: row.package.ecosystem,
        orgId: org.id,
        repoId: row.repoId,
        repoName: row.repo.name,
        packageId: row.package.id,
        name: row.package.name,
        constraint: row.constraint,
        version: row.installedVersion,
        direct: row.direct,
      });
    }
  }

  const publicActions = await publicActionsForScan(
    { db, log, heartbeat },
    deps.filter((d) => d.ecosystem === "GitHub Actions").map((d) => d.name)
  );
  const queries = planQueries(
    deps.filter((d) => d.ecosystem !== "GitHub Actions" || publicActions.has(d.name))
  );
  counts.queries = queries.length;
  const hits =
    queries.length === 0
      ? []
      : await queryOsvBatchHits(
          queries.map((q) => ({
            ecosystem: q.ecosystem,
            name: q.name,
            version: q.version,
            ...(q.constraint ? { constraint: true } : {}),
          })),
          heartbeat
        );

  // Every id OSV answered with, and the package it was first found for.
  const wanted = new Map<string, Wanted>();
  hits.forEach((list, i) => {
    const query = queries[i];
    if (list.length > 0) counts.vulnerableQueries++;
    for (const hit of list) {
      if (!wanted.has(hit.id)) {
        wanted.set(hit.id, {
          ...hit,
          packageId: query.packageId,
          packageName: query.name,
          ecosystem: query.ecosystem,
        });
      }
    }
  });
  // Rows stored before covered packages were recorded are refetched even when OSV no
  // longer answers with them (the repos upgraded): upload-time resolution needs the list.
  const backfill = await db.$queryRaw<
    { osvId: string; packageId: string; name: string; ecosystem: string }[]
  >`
    SELECT a."osvId", a."packageId", p."name", p."ecosystem"
    FROM "advisory" a JOIN "package" p ON p."id" = a."packageId"
    WHERE a."packages" IS NULL
    ORDER BY a."osvId"
    LIMIT ${COVERAGE_BACKFILL_LIMIT}`;
  for (const row of backfill) {
    if (wanted.has(row.osvId) || !isEcosystem(row.ecosystem)) continue;
    wanted.set(row.osvId, {
      modified: null,
      packageId: row.packageId,
      packageName: row.name,
      ecosystem: row.ecosystem,
    });
  }
  counts.advisoriesBackfilled = backfill.length;
  const { advisoryOf, merges, withdrawn } = await storeAdvisories(
    { db, log, heartbeat },
    wanted,
    counts
  );
  if (withdrawn.size > 0) {
    // A withdrawn record is never written again; an empty list stops its backfill.
    await db.$executeRaw`
      UPDATE "advisory" SET "packages" = '[]'::jsonb
      WHERE "osvId" = ANY(${[...withdrawn]}::text[]) AND "packages" IS NULL`;
  }
  if (merges.size > 0) await mergeDuplicates(db, orgs, merges, counts);

  const matches = queries.map((query, i) => ({
    query,
    advisoryIds: [
      ...new Set(
        (hits[i] ?? []).flatMap((h) => {
          const id = advisoryOf(h.id);
          return id ? [id] : [];
        })
      ),
    ],
  }));

  const smtp = smtpConfig();
  for (const org of orgs) {
    const scoped = withOrg(db, org.id);
    const orgMatches = matches
      .map((m) => ({
        query: { ...m.query, dependents: m.query.dependents.filter((d) => d.orgId === org.id) },
        advisoryIds: m.advisoryIds,
      }))
      .filter((m) => m.query.dependents.length > 0 && m.advisoryIds.length > 0);
    const advisoryIds = [...new Set(orgMatches.flatMap((m) => m.advisoryIds))];
    const existing = await scoped.alert.findMany({
      where: { advisoryId: { in: advisoryIds } },
      select: { id: true, advisoryId: true, repoId: true, resolvedAt: true },
    });
    // OSV says a resolved pair is affected again (the advisory's ranges grew, or the
    // ingest check could not see it): the alert is open again, without a second email.
    const atRiskKeys = new Set(
      orgMatches.flatMap((m) =>
        m.advisoryIds.flatMap((advisoryId) =>
          m.query.dependents.map((d) => alertKey(advisoryId, d.repoId))
        )
      )
    );
    const reopen = existing.filter(
      (a) => a.resolvedAt !== null && atRiskKeys.has(alertKey(a.advisoryId, a.repoId))
    );
    if (reopen.length > 0) {
      const res = await scoped.alert.updateMany({
        where: { id: { in: reopen.map((a) => a.id) } },
        data: { resolvedAt: null },
      });
      counts.alertsReopened += res.count;
    }
    const candidates = newAlertCandidates(
      orgMatches,
      new Set(existing.map((a) => alertKey(a.advisoryId, a.repoId))),
      (repoId) =>
        alertKindFor(repoState.get(repoId) ?? { securityScannedAt: null, includedChangedAt: null })
    );
    if (candidates.length > 0) {
      const created = await scoped.alert.createMany({ data: candidates, skipDuplicates: true });
      const backlog = candidates.filter((c) => c.kind === "backlog").length;
      // skipDuplicates can only lower the count; attribute any shortfall to "new" first.
      counts.alertsBacklog += Math.min(backlog, created.count);
      counts.alertsNew += Math.max(0, created.count - backlog);
    }
    // Every repo whose dependencies went through this run is scanned from now on.
    const scannedRepoIds = [
      ...new Set(deps.filter((d) => d.orgId === org.id).map((d) => d.repoId)),
    ];
    if (scannedRepoIds.length > 0) {
      await scoped.repo.updateMany({
        where: { id: { in: scannedRepoIds } },
        data: { securityScannedAt: startedAt },
      });
    }

    // Undelivered alerts include earlier runs whose delivery failed or ran without SMTP.
    const pending = await scoped.alert.findMany({
      where: { deliveredAt: null },
      select: {
        id: true,
        repoId: true,
        advisoryId: true,
        kind: true,
        repo: { select: { name: true, included: true } },
        advisory: {
          select: {
            osvId: true,
            summary: true,
            severity: true,
            affected: true,
            fixedVersion: true,
            package: { select: { name: true, ecosystem: true, actionTags: true } },
          },
        },
      },
    });
    // Which installed dependency puts each (advisory, repo) pair at risk right now. Keyed by
    // advisory, not package: one OSV record can cover several packages (e.g. payload's drivers).
    const atRisk = new Map<string, StackDependency>();
    for (const m of orgMatches) {
      for (const advisoryId of m.advisoryIds) {
        for (const dep of m.query.dependents) {
          const key = alertKey(advisoryId, dep.repoId);
          const prev = atRisk.get(key);
          if (!prev || (dep.direct && !prev.direct)) atRisk.set(key, dep);
        }
      }
    }
    // A pending alert whose repo no longer has a vulnerable version installed is stale.
    const live = pending.filter(
      (a) => a.repo.included && atRisk.has(alertKey(a.advisoryId, a.repoId))
    );
    const { urgent, backlog, held } = splitPending(live);
    counts.alertsHeld += held;
    if ((urgent.length === 0 && backlog.length === 0) || !smtp) continue;
    const groups = new Map<string, AlertGroup>();
    for (const alert of urgent) {
      const adv = alert.advisory;
      const group = groups.get(adv.osvId) ?? {
        ecosystem: isEcosystem(adv.package.ecosystem) ? adv.package.ecosystem : undefined,
        actionTags: storedActionTags(adv.package.actionTags),
        osvId: adv.osvId,
        packageName: adv.package.name,
        summary: adv.summary,
        severity: adv.severity,
        affected: adv.affected as unknown as OsvRange[],
        fallbackFixed: adv.fixedVersion,
        repos: [],
      };
      const dep = atRisk.get(alertKey(alert.advisoryId, alert.repoId));
      group.repos.push({
        name: alert.repo.name,
        installedVersion: dep
          ? dep.name === adv.package.name
            ? dep.version
            : `${dep.name}@${dep.version}`
          : "?",
        direct: dep?.direct ?? false,
      });
      groups.set(adv.osvId, group);
    }

    const summary = backlogSummary(backlog);
    const firstScan: FirstScanSummary | null = summary
      ? { ...summary, url: `${getEnv().BETTER_AUTH_URL.replace(/\/$/, "")}/bulletins` }
      : null;

    let sent = 0;
    for (const recipient of await orgRecipients(db, org.id)) {
      const email = renderSecurityAlertEmail(
        recipient.language,
        [...groups.values()],
        firstScan,
        getEnv().BETTER_AUTH_URL
      );
      const result = await sendMail({ to: recipient.to, ...email }, smtp);
      if (result.status === "sent") sent++;
      else if (result.status === "failed") {
        counts.emailsFailed++;
        log.warn({ orgId: org.id, error: result.error }, "security: alert email failed");
      }
    }
    counts.emailsSent += sent;
    // Delivered once anyone received it; a total failure keeps the alerts for the next run.
    if (sent > 0) {
      const res = await scoped.alert.updateMany({
        where: { id: { in: [...urgent, ...backlog].map((a) => a.id) } },
        data: { deliveredAt: new Date() },
      });
      counts.alertsDelivered += res.count;
    }
  }

  if (!smtp && counts.alertsNew + counts.alertsBacklog > 0) {
    log.warn(
      { alertsNew: counts.alertsNew, alertsBacklog: counts.alertsBacklog },
      "security: SMTP not configured; alerts kept undelivered"
    );
  }
  log.info(counts, "security: done");
  return { counts };
}
