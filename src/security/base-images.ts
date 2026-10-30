import { JobLockLostError } from "@/lib/jobs/queue";
import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { renderBaseImageAlertEmail, type BaseImageEmailGroup } from "@/lib/email/alert-email";
import { sendMail, smtpConfig } from "@/lib/email/mailer";
import { orgRecipients } from "@/lib/email/recipients";
import { getEnv } from "@/lib/env";
import { lineLifecycle, lowestSupportedLineAbove } from "@/lib/runtime-eol";
import { fetchJson } from "@/lib/platforms/fetch-with-retry";
import { osvVulnSchema, severityOf, type OsvVuln } from "@/sources/osv";
import type { JobContext, JobResult } from "@/worker/types";
import { baseImagePackages, imageDistro, type ImageDistro } from "@scan/distros";

import { FIX_WINDOW_MS, stringArray } from "./base-image-view";
import { severityLevel, severityRank } from "./plan";

export function baseImageAction(distro: ImageDistro, now: Date): string {
  if (lineLifecycle(distro.name, distro.version, now) !== "eol")
    return `rebuild on the latest ${distro.image} tag`;
  const next = lowestSupportedLineAbove(distro.name, distro.version, now);
  if (!next)
    return `${distro.name} ${distro.version} is end-of-life; read the advisory and plan a base image migration`;
  return `${distro.name} ${distro.version} is end-of-life; migrate to ${distro.name} ${next} or later`;
}

export interface ReleaseFix {
  package: string;
  version: string;
}

export interface ReleaseAdvisory {
  vuln: OsvVuln;
  /** Watched packages the advisory names for the release. */
  packages: string[];
  /** `fixed` events for the release; empty while the issue is open there. */
  fixes: ReleaseFix[];
}

/** Distro security announcements: their `published` is the date the fix went out. */
export function isFixAnnouncement(osvId: string): boolean {
  return /^(?:DSA|DLA|DTSA|USN)-/.test(osvId);
}

export function releaseFixes(
  vuln: OsvVuln,
  ecosystem: string,
  packages: readonly string[]
): ReleaseFix[] {
  const fixes = new Map<string, ReleaseFix>();
  for (const affected of vuln.affected) {
    if (affected.package.ecosystem !== ecosystem || !packages.includes(affected.package.name))
      continue;
    for (const range of affected.ranges ?? []) {
      if (range.type !== "ECOSYSTEM") continue;
      for (const event of range.events) {
        if (!event.fixed) continue;
        fixes.set(`${affected.package.name}\0${event.fixed}`, {
          package: affected.package.name,
          version: event.fixed,
        });
      }
    }
  }
  return [...fixes.values()];
}

const packageResult = z.object({
  vulns: z.array(osvVulnSchema).default([]),
  next_page_token: z.string().optional(),
});

/** No installed OS version is known: query the release's advisories, never invent a version. */
export async function queryBaseImageAdvisories(
  distro: ImageDistro,
  heartbeat: () => Promise<void>
): Promise<Map<string, ReleaseAdvisory>> {
  const watched = baseImagePackages(distro);
  const found = new Map<string, ReleaseAdvisory>();
  for (const name of watched) {
    let token: string | undefined;
    do {
      await heartbeat();
      const page = await fetchJson(
        "osv:base-image",
        "https://api.osv.dev/v1/query",
        packageResult,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            package: { name, ecosystem: distro.ecosystem },
            ...(token ? { page_token: token } : {}),
          }),
          timeoutMs: 30_000,
        }
      );
      for (const vuln of page.vulns) {
        if (
          vuln.withdrawn ||
          !vuln.affected.some(
            (a) => a.package.ecosystem === distro.ecosystem && a.package.name === name
          )
        )
          continue;
        const packages = [...new Set([...(found.get(vuln.id)?.packages ?? []), name])].sort();
        found.set(vuln.id, {
          vuln,
          packages,
          fixes: releaseFixes(vuln, distro.ecosystem, packages),
        });
      }
      token = page.next_page_token;
    } while (token);
  }
  return found;
}

export const fixKey = (fix: ReleaseFix): string => `${fix.package}\0${fix.version}`;

/**
 * Records when each fixed version of the release first appeared and returns the fix dates.
 * The first query of a release is its baseline: fixes seen then are not news (null), unless a
 * distro announcement dates them. Later, a new fixed version is dated by its announcement or,
 * without one, by the run that first saw it. `BaseImageFix` is a global catalog table.
 */
export async function syncFixCatalog(
  db: PrismaClient,
  ecosystem: string,
  advisories: ReadonlyMap<string, ReleaseAdvisory>,
  now: Date
): Promise<Map<string, Date | null>> {
  const baseline = !(await db.baseImageDistro.findUnique({ where: { ecosystem } }));
  const announced = new Map<string, Date>();
  const seen = new Map<string, ReleaseFix>();
  for (const { vuln, fixes } of advisories.values()) {
    const published =
      isFixAnnouncement(vuln.id) && vuln.published ? new Date(vuln.published) : null;
    for (const fix of fixes) {
      seen.set(fixKey(fix), fix);
      const previous = announced.get(fixKey(fix));
      if (published && (!previous || published < previous)) announced.set(fixKey(fix), published);
    }
  }
  const stored = new Map(
    (
      await db.baseImageFix.findMany({
        where: { ecosystem },
        select: { id: true, package: true, version: true, fixedAt: true },
      })
    ).map((row) => [fixKey(row), row])
  );
  const fixedAt = new Map<string, Date | null>();
  const fresh: { ecosystem: string; package: string; version: string; fixedAt: Date | null }[] = [];
  for (const [key, fix] of seen) {
    const date = announced.get(key);
    const row = stored.get(key);
    if (row) {
      // An announcement imported after the version was first seen moves the date back.
      if (row.fixedAt && date && date < row.fixedAt)
        await db.baseImageFix.update({ where: { id: row.id }, data: { fixedAt: date } });
      fixedAt.set(key, row.fixedAt && date && date < row.fixedAt ? date : row.fixedAt);
      continue;
    }
    const value = baseline ? (date ?? null) : date && date < now ? date : now;
    fresh.push({ ecosystem, ...fix, fixedAt: value });
    fixedAt.set(key, value);
  }
  if (fresh.length) await db.baseImageFix.createMany({ data: fresh, skipDuplicates: true });
  const unfixed = [...advisories.values()].filter((a) => a.fixes.length === 0).length;
  await db.baseImageDistro.upsert({
    where: { ecosystem },
    create: { ecosystem, unfixed, checkedAt: now },
    update: { unfixed, checkedAt: now },
  });
  return fixedAt;
}

export interface PlannedBaseImageAlert {
  osvId: string;
  summary: string | null;
  severity: string | null;
  packages: string[];
  fixedAt: Date;
  publishedAt: Date | null;
  modifiedAt: Date;
}

function referencedIds(vuln: OsvVuln): string[] {
  return [...(vuln.upstream ?? []), ...(vuln.aliases ?? [])];
}

/**
 * The advisories one watched image alerts on: a fix for the release published within the
 * window and after Briff first saw the image (`since`). Older fixes are assumed to be in any
 * image built since; open issues have nothing to rebuild for. An announcement stands for the
 * CVE records it names, with the highest severity among them (DSA/DLA carry none).
 */
export function planImageAlerts(
  advisories: ReadonlyMap<string, ReleaseAdvisory>,
  fixedAt: ReadonlyMap<string, Date | null>,
  since: Date,
  now: Date
): PlannedBaseImageAlert[] {
  const windowStart = now.getTime() - FIX_WINDOW_MS;
  const recent = new Map<string, { advisory: ReleaseAdvisory; fixedAt: Date }>();
  for (const [osvId, advisory] of advisories) {
    const dates = advisory.fixes
      .map((fix) => fixedAt.get(fixKey(fix)))
      .filter((d): d is Date => d instanceof Date);
    if (!dates.length) continue;
    const latest = new Date(Math.max(...dates.map((d) => d.getTime())));
    if (latest.getTime() > since.getTime() && latest.getTime() >= windowStart)
      recent.set(osvId, { advisory, fixedAt: latest });
  }
  const covered = new Set<string>();
  for (const [osvId, { advisory }] of recent)
    if (isFixAnnouncement(osvId))
      for (const id of referencedIds(advisory.vuln)) if (id !== osvId) covered.add(id);
  const planned: PlannedBaseImageAlert[] = [];
  for (const [osvId, { advisory, fixedAt: date }] of recent) {
    if (covered.has(osvId) && !isFixAnnouncement(osvId)) continue;
    const severities = [
      severityOf(advisory.vuln),
      ...(isFixAnnouncement(osvId)
        ? referencedIds(advisory.vuln).map((id) => {
            const named = advisories.get(id);
            return named ? severityOf(named.vuln) : null;
          })
        : []),
    ];
    const severity = severities.reduce<string | null>(
      (best, s) => (severityRank(s) > severityRank(best) ? s : best),
      null
    );
    const packages = new Set(advisory.packages);
    if (isFixAnnouncement(osvId))
      for (const id of referencedIds(advisory.vuln))
        for (const name of advisories.get(id)?.packages ?? []) packages.add(name);
    planned.push({
      osvId,
      summary: advisory.vuln.summary ?? null,
      severity,
      packages: [...packages].sort(),
      fixedAt: date,
      publishedAt: advisory.vuln.published ? new Date(advisory.vuln.published) : null,
      modifiedAt: new Date(advisory.vuln.modified),
    });
  }
  return planned.sort((a, b) => a.osvId.localeCompare(b.osvId));
}

/** Same-day email only for a group with a rated critical or high advisory. */
export function emailsBaseImageGroup(severities: readonly (string | null)[]): boolean {
  return severities.some((s) => {
    const level = severityLevel(s);
    return level === "CRITICAL" || level === "HIGH";
  });
}

interface Release {
  distro: ImageDistro;
  advisories: Map<string, ReleaseAdvisory>;
  fixedAt: Map<string, Date | null>;
}

export async function baseImageScan({ db, log, heartbeat }: JobContext): Promise<JobResult> {
  const now = new Date();
  const counts = {
    images: 0,
    candidates: 0,
    created: 0,
    deactivated: 0,
    held: 0,
    errors: 0,
    emailsSent: 0,
    deliveryLocked: 0,
  };
  const releases = new Map<string, Release | null>();
  const loadRelease = async (distro: ImageDistro): Promise<Release | null> => {
    if (!releases.has(distro.ecosystem)) {
      try {
        const advisories = await queryBaseImageAdvisories(distro, heartbeat);
        const fixedAt = await syncFixCatalog(db, distro.ecosystem, advisories, now);
        releases.set(distro.ecosystem, { distro, advisories, fixedAt });
      } catch (err) {
        if (err instanceof JobLockLostError) throw err;
        counts.errors++;
        releases.set(distro.ecosystem, null);
        log.warn({ err, ecosystem: distro.ecosystem }, "base images: advisory query failed");
      }
    }
    return releases.get(distro.ecosystem) ?? null;
  };
  for (const org of await db.org.findMany({
    where: { baseImageAlerts: true },
    select: { id: true },
  })) {
    await heartbeat();
    const scoped = withOrg(db, org.id);
    const repos = await scoped.repo.findMany({
      where: { included: true },
      select: {
        id: true,
        includedChangedAt: true,
        runtimes: { select: { name: true, image: true } },
      },
    });
    const live = new Set<string>();
    for (const repo of repos) {
      await heartbeat();
      const images = [
        ...new Set(
          repo.runtimes
            .filter((r) => ["debian", "ubuntu", "alpine"].includes(r.name))
            .flatMap((r) => (r.image ? [r.image] : []))
        ),
      ];
      let complete = true;
      for (const image of images) {
        const distro = imageDistro(image);
        if (!distro) continue;
        counts.images++;
        const release = await loadRelease(distro);
        if (!release) {
          complete = false;
          continue;
        }
        await scoped.baseImageWatch.createMany({
          data: [{ orgId: org.id, repoId: repo.id, image, since: now }],
          skipDuplicates: true,
        });
        const watch = await scoped.baseImageWatch.findUniqueOrThrow({
          where: { repoId_image: { repoId: repo.id, image } },
          select: { since: true },
        });
        // A repo included again starts over, like a newly seen image.
        if (repo.includedChangedAt && repo.includedChangedAt > watch.since) {
          watch.since = repo.includedChangedAt;
          await scoped.baseImageWatch.updateMany({
            where: { repoId: repo.id, image },
            data: { since: watch.since },
          });
        }
        live.add(`${repo.id}\0${image}`);
        counts.candidates += release.advisories.size;
        const withFix = [...release.advisories]
          .filter(([, a]) => a.fixes.length > 0)
          .map(([id]) => id);
        counts.deactivated += (
          await scoped.baseImageAlert.updateMany({
            // Withdrawn or taken back, or fixed before the image's watch started (a repo
            // included again): no longer an alert.
            where: {
              repoId: repo.id,
              image,
              active: true,
              OR: [
                { osvId: { notIn: withFix } },
                { fixedAt: null },
                { fixedAt: { lte: watch.since } },
              ],
            },
            data: { active: false },
          })
        ).count;
        const action = baseImageAction(distro, now);
        for (const alert of planImageAlerts(
          release.advisories,
          release.fixedAt,
          watch.since,
          now
        )) {
          await heartbeat();
          const key = { repoId: repo.id, image, osvId: alert.osvId };
          const fields = {
            active: true,
            summary: alert.summary,
            severity: alert.severity,
            packages: alert.packages,
            action,
            fixedAt: alert.fixedAt,
            modifiedAt: alert.modifiedAt,
          };
          const existing = await scoped.baseImageAlert.findUnique({
            where: { repoId_image_osvId: key },
            select: { id: true },
          });
          if (existing)
            await scoped.baseImageAlert.update({ where: { id: existing.id }, data: fields });
          else {
            const created = await scoped.baseImageAlert.createMany({
              data: [
                {
                  ...key,
                  ...fields,
                  orgId: org.id,
                  ecosystem: distro.ecosystem,
                  publishedAt: alert.publishedAt,
                  kind: "new",
                },
              ],
              skipDuplicates: true,
            });
            counts.created += created.count;
          }
        }
      }
      if (complete && images.length)
        await scoped.repo.update({ where: { id: repo.id }, data: { baseImageScannedAt: now } });
    }
    const smtp = smtpConfig();
    if (!smtp) continue;
    // Hold the lock across SMTP and its marker write; scanning can overlap safely.
    await db.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(68421::int, hashtext(${org.id})) AS locked`;
        if (!lock?.locked) {
          counts.deliveryLocked++;
          return;
        }
        const pending = await scoped.baseImageAlert.findMany({
          where: {
            active: true,
            deliveredAt: null,
            // The window runs from the fix, not from when the row was stored.
            fixedAt: { gte: new Date(now.getTime() - FIX_WINDOW_MS) },
            repo: { included: true },
          },
          include: { repo: { select: { name: true } } },
        });
        const byImage = new Map<string, typeof pending>();
        for (const row of pending) {
          const key = `${row.repoId}\0${row.image}`;
          if (!live.has(key)) continue;
          byImage.set(key, [...(byImage.get(key) ?? []), row]);
        }
        const ready = [...byImage.values()].filter((rows) =>
          emailsBaseImageGroup(rows.map((r) => r.severity))
        );
        counts.held += [...byImage.values()]
          .filter((rows) => !ready.includes(rows))
          .reduce((n, rows) => n + rows.length, 0);
        if (!ready.length) return;
        const groups: BaseImageEmailGroup[] = ready
          .map((rows) => ({
            image: rows[0].image,
            repo: rows[0].repo.name,
            action: rows[0].action,
            advisories: rows
              .map((r) => ({
                osvId: r.osvId,
                severity: r.severity,
                packages: stringArray(r.packages),
              }))
              .sort(
                (a, b) =>
                  severityRank(b.severity) - severityRank(a.severity) ||
                  a.osvId.localeCompare(b.osvId)
              ),
          }))
          .sort((a, b) => a.repo.localeCompare(b.repo) || a.image.localeCompare(b.image));
        let sent = 0;
        for (const recipient of await orgRecipients(db, org.id)) {
          await heartbeat();
          const email = renderBaseImageAlertEmail(
            recipient.language,
            groups,
            getEnv().BETTER_AUTH_URL
          );
          if ((await sendMail({ to: recipient.to, ...email }, smtp)).status === "sent") sent++;
        }
        counts.emailsSent += sent;
        if (sent)
          await scoped.baseImageAlert.updateMany({
            where: { id: { in: ready.flat().map((a) => a.id) }, deliveredAt: null },
            data: { deliveredAt: new Date() },
          });
      },
      { maxWait: 10_000, timeout: 30 * 60_000 }
    );
  }
  if (releases.size && [...releases.values()].every((entry) => entry === null))
    throw new Error("All base image advisory queries failed");
  log.info(counts, "base images: done");
  return { counts };
}
