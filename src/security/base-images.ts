import { JobLockLostError } from "@/lib/jobs/queue";
import { z } from "zod";

import { withOrg } from "@/lib/db/with-org";
import { renderSecurityAlertEmail } from "@/lib/email/alert-email";
import { sendMail, smtpConfig } from "@/lib/email/mailer";
import { orgRecipients } from "@/lib/email/recipients";
import { getEnv } from "@/lib/env";
import { lineLifecycle, lowestSupportedLineAbove } from "@/lib/runtime-eol";
import { fetchJson } from "@/lib/platforms/fetch-with-retry";
import { osvVulnSchema, severityOf, type OsvVuln } from "@/sources/osv";
import type { JobContext, JobResult } from "@/worker/types";
import { baseImagePackages, imageDistro, type ImageDistro } from "@scan/distros";

import { emailsImmediately, type AlertGroup } from "./plan";

export function baseImageAction(distro: ImageDistro, now: Date): string {
  if (lineLifecycle(distro.name, distro.version, now) !== "eol")
    return `rebuild on the latest ${distro.image} tag`;
  const next = lowestSupportedLineAbove(distro.name, distro.version, now);
  if (!next)
    return `${distro.name} ${distro.version} is end-of-life; read the advisory and plan a base image migration`;
  return `${distro.name} ${distro.version} is end-of-life; migrate to ${distro.name} ${next} or later`;
}

const packageResult = z.object({
  vulns: z.array(osvVulnSchema).default([]),
  next_page_token: z.string().optional(),
});

/** No installed OS version is known: query candidates for the release, never invent one. */
export async function queryBaseImageAdvisories(
  distro: ImageDistro,
  heartbeat: () => Promise<void>
): Promise<Map<string, { vuln: OsvVuln; packages: string[] }>> {
  const found = new Map<string, { vuln: OsvVuln; packages: string[] }>();
  for (const name of baseImagePackages(distro)) {
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
        const previous = found.get(vuln.id);
        found.set(vuln.id, { vuln, packages: [...new Set([...(previous?.packages ?? []), name])] });
      }
      token = page.next_page_token;
    } while (token);
  }
  return found;
}

export async function baseImageScan({ db, log, heartbeat }: JobContext): Promise<JobResult> {
  const now = new Date();
  const counts = {
    images: 0,
    candidates: 0,
    created: 0,
    errors: 0,
    emailsSent: 0,
    deliveryLocked: 0,
  };
  const cached = new Map<string, Awaited<ReturnType<typeof queryBaseImageAdvisories>> | null>();
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
        name: true,
        baseImageScannedAt: true,
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
        if (!cached.has(distro.ecosystem)) {
          try {
            cached.set(distro.ecosystem, await queryBaseImageAdvisories(distro, heartbeat));
          } catch (err) {
            if (err instanceof JobLockLostError) throw err;
            counts.errors++;
            cached.set(distro.ecosystem, null);
            log.warn({ err, ecosystem: distro.ecosystem }, "base images: advisory query failed");
          }
        }
        const candidates = cached.get(distro.ecosystem);
        if (!candidates) {
          complete = false;
          continue;
        }
        await scoped.baseImageAlert.updateMany({
          where: { repoId: repo.id, image, osvId: { notIn: [...candidates.keys()] } },
          data: { active: false },
        });
        for (const [osvId, { vuln, packages }] of candidates) {
          await heartbeat();
          counts.candidates++;
          live.add(`${repo.id}\0${image}\0${osvId}`);
          const key = { repoId: repo.id, image, osvId };
          const existing = await scoped.baseImageAlert.findUnique({
            where: { repoId_image_osvId: key },
            select: { id: true },
          });
          const fields = {
            active: true,
            summary: vuln.summary ?? null,
            severity: severityOf(vuln),
            packages,
            action: baseImageAction(distro, now),
            modifiedAt: new Date(vuln.modified),
          };
          if (existing)
            await scoped.baseImageAlert.update({ where: { id: existing.id }, data: fields });
          else {
            await scoped.baseImageAlert.createMany({
              data: [
                {
                  ...key,
                  ...fields,
                  orgId: org.id,
                  ecosystem: distro.ecosystem,
                  publishedAt: vuln.published ? new Date(vuln.published) : null,
                  kind:
                    !repo.baseImageScannedAt ||
                    (repo.includedChangedAt && repo.includedChangedAt > repo.baseImageScannedAt)
                      ? "backlog"
                      : "new",
                },
              ],
              skipDuplicates: true,
            });
            counts.created++;
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
          where: { deliveredAt: null, repo: { included: true } },
          include: { repo: { select: { name: true } } },
        });
        const ready = pending.filter(
          (a) => live.has(`${a.repoId}\0${a.image}\0${a.osvId}`) && emailsImmediately(a.severity)
        );
        if (!ready.length) return;
        const groups: AlertGroup[] = ready.map((a) => ({
          osvId: a.osvId,
          packageName: `Base image advisories: ${a.image}`,
          summary: `Package presence and installed versions are unverified. ${a.summary ?? "Read the advisory."}`,
          severity: a.severity,
          affected: [],
          fallbackFixed: a.action,
          repos: [
            {
              name: a.repo.name,
              installedVersion: "OS package inventory unavailable",
              direct: true,
            },
          ],
        }));
        let sent = 0;
        for (const recipient of await orgRecipients(db, org.id)) {
          await heartbeat();
          const email = renderSecurityAlertEmail(
            recipient.language,
            groups,
            null,
            getEnv().BETTER_AUTH_URL
          );
          if ((await sendMail({ to: recipient.to, ...email }, smtp)).status === "sent") sent++;
        }
        counts.emailsSent += sent;
        if (sent)
          await scoped.baseImageAlert.updateMany({
            where: { id: { in: ready.map((a) => a.id) }, deliveredAt: null },
            data: { deliveredAt: new Date() },
          });
      },
      { maxWait: 10_000, timeout: 30 * 60_000 }
    );
  }
  if (cached.size && [...cached.values()].every((entry) => entry === null))
    throw new Error("All base image advisory queries failed");
  return { counts };
}
