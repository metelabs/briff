import { storedActionTags } from "@/sources/github-actions";
import { loadBaseImageGroups } from "@/security/base-image-view";
import type { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { PRODUCT_LANGUAGE } from "@/lib/i18n";

import { severityRank } from "@/security/plan";
import { affectedInstalls, fixedVersionFor, type OsvRange } from "@/sources/osv";
import {
  asEcosystem,
  asPackageManager,
  type Ecosystem,
  type PackageManager,
} from "@scan/ecosystems";

import {
  declarationOf,
  mergeFixedLists,
  type AlertRow,
  type VersionDeclaration,
} from "./alert-rows";
import { isoWeekLabel, RELEASE_KINDS, type Section } from "./bulletin";
import {
  sectionOf,
  type BulletinView,
  type BulletinViewAlert,
  type BulletinViewItem,
} from "./bulletin-model";
import { recommendFixes, type RepoFix } from "./fixes";
import { packageUpgrades, parseUpgrades } from "./upgrades";

// Loaded through withOrg so a view can only ever contain the requesting org's rows.

export {
  advisoryCount,
  allItems,
  BULLETIN_ALERT_LIMIT,
  CONDENSED_NOTE,
  restCount,
  sectionOf,
  type BulletinView,
  type BulletinViewAlert,
  type BulletinViewItem,
} from "./bulletin-model";

export {
  declarationOf,
  mergeFixedLists,
  type AlertRow,
  type VersionDeclaration,
} from "./alert-rows";

export async function loadBulletinView(
  db: PrismaClient,
  orgId: string,
  bulletinId: string
): Promise<BulletinView | null> {
  const scoped = withOrg(db, orgId);
  const bulletin = await scoped.bulletin.findFirst({
    where: { id: bulletinId },
    include: { stream: { select: { name: true } } },
  });
  if (!bulletin) return null;
  const rows = await scoped.bulletinItem.findMany({
    where: { bulletinId },
    orderBy: { order: "asc" },
    select: {
      itemId: true,
      bucket: true,
      section: true,
      headline: true,
      line: true,
      action: true,
      todo: true,
      affectedRepos: true,
      foldedItemIds: true,
      upgrades: true,
      item: {
        select: {
          title: true,
          url: true,
          source: { select: { name: true } },
          triage: { select: { dueAt: true } },
        },
      },
    },
  });
  const foldedIds = rows.flatMap((r) =>
    Array.isArray(r.foldedItemIds) ? r.foldedItemIds.map(String) : []
  );
  // Items are global catalog rows; the ids come from this org's bulletin items.
  const foldedItems =
    foldedIds.length > 0
      ? await db.item.findMany({
          where: { id: { in: foldedIds } },
          select: { id: true, title: true, url: true, source: { select: { kind: true } } },
        })
      : [];
  const foldedById = new Map(foldedItems.map((i) => [i.id, i]));
  const items = rows.map((r) => ({
    section: r.bucket === "minor" ? ("minor" as const) : sectionOf(r.section, r.bucket),
    item: {
      itemId: r.itemId,
      bucket: r.bucket,
      headline: r.headline || r.item.title,
      line: r.line,
      action: r.action,
      todo: r.todo,
      title: r.item.title,
      url: r.item.url,
      sourceName: r.item.source.name,
      affectedRepos: Array.isArray(r.affectedRepos) ? r.affectedRepos.map(String) : [],
      dueAt: r.item.triage?.dueAt ?? null,
      folded: (Array.isArray(r.foldedItemIds) ? r.foldedItemIds.map(String) : []).flatMap((id) => {
        const f = foldedById.get(id);
        return f ? [{ title: f.title, url: f.url, release: RELEASE_KINDS.has(f.source.kind) }] : [];
      }),
      upgrades: parseUpgrades(r.upgrades),
    } satisfies BulletinViewItem,
  }));
  const inSection = (section: Section | "minor") =>
    items.filter((i) => i.section === section).map((i) => i.item);

  const alertRows = await scoped.alert.findMany({
    where: {
      createdAt: { gte: bulletin.periodStart, lt: bulletin.periodEnd },
      // The stream's current repos; a bulletin without a stream falls back to all included repos.
      repo: bulletin.streamId
        ? { streams: { some: { streamId: bulletin.streamId } } }
        : { included: true },
    },
    select: {
      repoId: true,
      kind: true,
      repo: { select: { name: true } },
      advisory: {
        select: {
          osvId: true,
          severity: true,
          affected: true,
          fixedVersion: true,
          package: { select: { id: true, name: true, ecosystem: true } },
        },
      },
    },
  });
  const withInstalls = await attachInstalls(scoped, alertRows);
  const lineRows = (kind: "new" | "backlog") => withInstalls.filter((r) => r.kind === kind);

  return {
    id: bulletin.id,
    orgId,
    weekLabel: isoWeekLabel(bulletin.weekStart),
    streamId: bulletin.streamId,
    streamName: bulletin.stream?.name ?? null,
    // Chrome is English for every bulletin, including older ones written in Turkish.
    language: PRODUCT_LANGUAGE,
    subject: bulletin.subject,
    summary: bulletin.summary,
    minorCount: bulletin.minorCount,
    model: bulletin.model,
    promptVersion: bulletin.promptVersion,
    condensed: bulletin.condensed,
    createdAt: bulletin.createdAt,
    emailStatus: bulletin.emailStatus,
    emailSentAt: bulletin.emailSentAt,
    preview: bulletin.preview,
    act: inSection("act"),
    know: inSection("know"),
    rest: inSection("rest"),
    minor: inSection("minor"),
    alerts: alertLinesOf(lineRows("new")),
    backlogAlerts: alertLinesOf(lineRows("backlog")),
    baseImageAlerts: await loadBaseImageGroups(
      db,
      orgId,
      bulletin.streamId
        ? { streams: { some: { streamId: bulletin.streamId } } }
        : { included: true },
      { gte: bulletin.periodStart, lt: bulletin.periodEnd }
    ),
  };
}

type ScopedDb = ReturnType<typeof withOrg>;

/**
 * Adds each alert's installed versions and direct/transitive relation from the repo's
 * dependency rows; installed versions resolve one fix per repo instead of the
 * advisory's full fixed list. Without a dependency row the relation is unknown and the
 * repo is treated as direct.
 */
export async function attachInstalls<
  R extends { repoId: string; advisory: { package: { id: string } } },
>(
  scoped: ScopedDb,
  rows: readonly R[]
): Promise<
  (R & {
    installedVersions: string[];
    directVersions: string[];
    direct: boolean;
    dev?: true;
    group?: string;
    requirement?: string;
    project?: string;
    actionTags?: Record<string, string>;
    manager?: PackageManager;
    declarations: Record<string, VersionDeclaration>;
  })[]
> {
  const deps =
    rows.length > 0
      ? await scoped.dependency.findMany({
          where: {
            repoId: { in: [...new Set(rows.map((r) => r.repoId))] },
            packageId: { in: [...new Set(rows.map((r) => r.advisory.package.id))] },
            // A requirement (`>=2.0`) is not an installed version.
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
            package: { select: { actionTags: true } },
          },
        })
      : [];
  const installed = new Map<string, string[]>();
  const directVersions = new Map<string, string[]>();
  // Development-only: every direct row of the repo's package is a dev one.
  const devOnly = new Map<string, boolean>();
  const groups = new Map<string, string>();
  const requirements = new Map<string, string>();
  const projects = new Map<string, string>();
  const managers = new Map<string, PackageManager>();
  const declarations = new Map<string, Record<string, VersionDeclaration>>();
  for (const d of deps) {
    const key = `${d.repoId}:${d.packageId}`;
    if (d.direct) {
      // Each installed version's own declaration (two conditional pins differ).
      const manager = asPackageManager(d.manager);
      const byVersion = declarations.get(key) ?? {};
      byVersion[d.installedVersion] ??= {
        actionTags: storedActionTags(d.package.actionTags),
        ...(d.dev ? { dev: true } : {}),
        ...(d.group ? { group: d.group } : {}),
        ...(d.requirement ? { requirement: d.requirement } : {}),
        ...(d.project ? { project: d.project } : {}),
        ...(manager ? { manager } : {}),
      };
      declarations.set(key, byVersion);
    }
    installed.set(key, [...(installed.get(key) ?? []), d.installedVersion]);
    if (d.direct) {
      directVersions.set(key, [...(directVersions.get(key) ?? []), d.installedVersion]);
      devOnly.set(key, (devOnly.get(key) ?? true) && d.dev);
      if (d.group && !groups.has(key)) groups.set(key, d.group);
      if (d.requirement && !requirements.has(key)) requirements.set(key, d.requirement);
      if (d.project && !projects.has(key)) projects.set(key, d.project);
    }
    const manager = asPackageManager(d.manager);
    if (manager && !managers.has(key)) managers.set(key, manager);
  }
  return rows.map((r) => {
    const key = `${r.repoId}:${r.advisory.package.id}`;
    const manager = managers.get(key);
    return {
      ...r,
      ...(devOnly.get(key) ? { dev: true as const } : {}),
      ...(groups.has(key) ? { group: groups.get(key) } : {}),
      ...(requirements.has(key) ? { requirement: requirements.get(key) } : {}),
      ...(projects.has(key) ? { project: projects.get(key) } : {}),
      ...(manager ? { manager } : {}),
      declarations: declarations.get(key) ?? {},
      installedVersions: installed.get(key) ?? [],
      /** The installed versions the repo declares itself; the others come in transitively. */
      directVersions: directVersions.get(key) ?? [],
      direct: directVersions.has(key) || !installed.has(key),
    };
  });
}

/**
 * The fix per installed release line (recommendFixes). The advisories' merged fixed
 * lists are used only when no affected repo has an installed version on record: with
 * a known version they could name a fix on a higher major, which the line rule forbids.
 */
function fixFor(
  repoFixes: readonly RepoFix[],
  fallbacks: (string | null)[],
  installedKnown: boolean
): Pick<BulletinViewAlert, "fixed" | "noLineFix"> {
  // Installed versions known but none affected any more: nothing to install.
  if (repoFixes.length === 0 && installedKnown) return { fixed: null, noLineFix: false };
  if (repoFixes.length === 0) return { fixed: mergeFixedLists(fallbacks), noLineFix: false };
  const lines = recommendFixes(null, repoFixes);
  if (!lines) return { fixed: null, noLineFix: true };
  return {
    fixed:
      lines.length === 1
        ? lines[0].version
        : lines.map((l) => `${l.version} (${l.repos.join(", ")})`).join(" · "),
    noLineFix: false,
  };
}

/**
 * One line per package: highest severity, repos merged, the advisories behind it,
 * and the fix per installed release line (fixes.ts, see fixFor). Repos without an
 * installed version on record add no fix; when none has one, the advisories' fixed
 * lists are merged to the highest per line.
 * Transitive-only packages get no fix and sort after the direct ones.
 * Sorted by severity, then advisory count, then name.
 */
export function alertLinesOf(rows: readonly AlertRow[]): BulletinViewAlert[] {
  interface Group {
    packageName: string;
    ecosystem: Exclude<Ecosystem, "npm"> | undefined;
    advisories: Map<string, { severity: string | null; fallback: string | null }>;
    repos: Set<string>;
    repoFixes: RepoFix[];
    unknownRepos: Set<string>;
    direct: boolean;
    installedKnown: boolean;
  }
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const pkg = r.advisory.package.name;
    const ecosystem = asEcosystem(r.advisory.package.ecosystem);
    // (ecosystem, name) is the package: an npm and a PyPI package of one name are two lines.
    const key = `${ecosystem ?? "npm"}\0${pkg}`;
    const g: Group = groups.get(key) ?? {
      packageName: pkg,
      ecosystem: ecosystem === "npm" ? undefined : ecosystem,
      advisories: new Map(),
      repos: new Set(),
      repoFixes: [],
      unknownRepos: new Set(),
      direct: false,
      installedKnown: false,
    };
    g.direct ||= r.direct;
    g.advisories.set(r.advisory.osvId, {
      severity: r.advisory.severity,
      fallback: r.advisory.fixedVersion,
    });
    g.repos.add(r.repo.name);
    const ranges = r.advisory.affected as OsvRange[];
    // Same filter as the act command (summariseAlerts): a version already past the fix adds
    // nothing, so it cannot turn a valid fix into "no fix".
    for (const installed of affectedInstalls(ranges, r.installedVersions, (v) => v)) {
      g.repoFixes.push({
        repo: r.repo.name,
        installed,
        fix: fixedVersionFor(ranges, installed),
        ...(g.ecosystem ? { ecosystem: g.ecosystem } : {}),
        ...declarationOf(r, installed),
      });
    }
    if (r.installedVersions.length > 0) g.installedKnown = true;
    else g.unknownRepos.add(r.repo.name);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => {
      const { packageName } = g;
      const advisories = [...g.advisories.entries()].sort(
        ([idA, a], [idB, b]) =>
          severityRank(b.severity) - severityRank(a.severity) || idA.localeCompare(idB)
      );
      return {
        packageName,
        ...(g.ecosystem ? { ecosystem: g.ecosystem } : {}),
        severity: advisories[0][1].severity,
        osvIds: advisories.map(([id]) => id),
        repos: [...g.repos].sort(),
        ...(g.direct
          ? fixFor(
              g.repoFixes,
              advisories.map(([, a]) => a.fallback),
              g.installedKnown
            )
          : { fixed: null, noLineFix: false }),
        transitive: !g.direct,
        // Same fix rule as `fixed` (every affected repo counts as direct for a direct line).
        installs: packageUpgrades(
          packageName,
          null,
          g.repoFixes.map((f) => ({ ...f, direct: g.direct })),
          [...g.unknownRepos]
        ),
      };
    })
    .sort(
      (a, b) =>
        Number(a.transitive) - Number(b.transitive) ||
        severityRank(b.severity) - severityRank(a.severity) ||
        b.osvIds.length - a.osvIds.length ||
        a.packageName.localeCompare(b.packageName)
    );
}
