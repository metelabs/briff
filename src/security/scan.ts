import type { Prisma } from "@/generated/prisma/client";
import { mapLimit } from "@/lib/concurrency";
import { withOrg } from "@/lib/db/with-org";
import { renderSecurityAlertEmail, type FirstScanSummary } from "@/lib/email/alert-email";
import { sendMail, smtpConfig } from "@/lib/email/mailer";
import { orgRecipients } from "@/lib/email/recipients";
import { getEnv } from "@/lib/env";
import { fetchOsvVuln, queryOsvBatchHits, toAdvisoryFields, type OsvRange } from "@/sources/osv";
import type { JobContext, JobResult } from "@/worker/types";
import { ECOSYSTEMS, isEcosystem, type Ecosystem } from "@scan/ecosystems";

import {
  alertKey,
  alertKindFor,
  backlogSummary,
  newAlertCandidates,
  planQueries,
  splitPending,
  type AlertGroup,
  type StackDependency,
} from "./plan";

const FETCH_CONCURRENCY = 8;

interface AdvisoryRef {
  id: string;
  affected: OsvRange[];
}

/**
 * security-scan (plan §7.4, no LLM): installed versions of every included repo
 * (direct and transitive) are checked against OSV; new (advisory × repo) pairs
 * become Alerts, `backlog` on a repo's first scan and `new` afterwards. One email per
 * org (per recipient) per run carries the new critical/high alerts and, after a first
 * scan, one summary of the backlog. Moderate and low alerts wait for the bulletin.
 */
export async function securityScan({ db, log }: JobContext): Promise<JobResult> {
  const startedAt = new Date();
  const counts = {
    orgs: 0,
    reposIncluded: 0,
    reposSkipped: 0,
    queries: 0,
    vulnerableQueries: 0,
    advisoriesFetched: 0,
    advisoryFetchErrors: 0,
    alertsNew: 0,
    alertsBacklog: 0,
    alertsDelivered: 0,
    alertsHeld: 0,
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
        version: row.installedVersion,
        direct: row.direct,
      });
    }
  }

  const queries = planQueries(deps);
  counts.queries = queries.length;
  const hits =
    queries.length === 0
      ? []
      : await queryOsvBatchHits(
          queries.map((q) => ({ ecosystem: q.ecosystem, name: q.name, version: q.version }))
        );

  // Fetch full records only for advisories that are new or changed since stored.
  const wanted = new Map<
    string,
    { modified: string | null; packageId: string; packageName: string; ecosystem: Ecosystem }
  >();
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
  const stored = await db.advisory.findMany({
    where: { osvId: { in: [...wanted.keys()] } },
    select: { id: true, osvId: true, modifiedAt: true, affected: true },
  });
  const advisories = new Map<string, AdvisoryRef>(
    stored.map((a) => [a.osvId, { id: a.id, affected: a.affected as unknown as OsvRange[] }])
  );
  const storedModified = new Map(stored.map((a) => [a.osvId, a.modifiedAt]));
  const toFetch = [...wanted.entries()].filter(([osvId, hit]) => {
    const known = storedModified.get(osvId);
    if (known === undefined) return true;
    return hit.modified !== null && (known === null || new Date(hit.modified) > known);
  });

  await mapLimit(toFetch, FETCH_CONCURRENCY, async ([osvId, hit]) => {
    try {
      const vuln = await fetchOsvVuln(osvId);
      if (vuln.withdrawn) {
        advisories.delete(osvId);
        return;
      }
      const fields = toAdvisoryFields(vuln, hit.packageName, hit.ecosystem);
      const data = { ...fields, affected: fields.affected as unknown as Prisma.InputJsonValue };
      const row = await db.advisory.upsert({
        where: { osvId },
        create: { ...data, packageId: hit.packageId },
        update: data,
        select: { id: true },
      });
      advisories.set(osvId, { id: row.id, affected: fields.affected });
      counts.advisoriesFetched++;
    } catch (err) {
      counts.advisoryFetchErrors++;
      log.warn({ err, osvId }, "security: advisory fetch failed");
    }
  });

  const matches = queries.map((query, i) => ({
    query,
    advisoryIds: (hits[i] ?? []).flatMap((h) => {
      const ref = advisories.get(h.id);
      return ref ? [ref.id] : [];
    }),
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
      select: { advisoryId: true, repoId: true },
    });
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
            package: { select: { name: true } },
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
