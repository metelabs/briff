import { BaseImageAdvisories } from "@/components/base-image-advisories";
import { loadBaseImageGroups } from "@/security/base-image-view";
import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/shell/app-shell";
import { ConnectReposButton } from "@/components/shell/connect-sheet";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader, SectionHeader } from "@/components/ui/section-header";
import { requireOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { plural } from "@/lib/format";
import { getEnv } from "@/lib/env";
import { SOURCE_URL } from "@/components/landing/links";
import { activeInstallationIds, recheckInFlight } from "@/lib/github/recheck";
import { loadMemberState, markAlertsSeen } from "@/lib/member-state";
import { localScanCommands, SCANNER_MAJOR } from "@/lib/scan/workflow";
import { PRODUCT_LANGUAGE, strings } from "@/lib/i18n";
import { loadStreamScope, repoScope } from "@/lib/stream-scope";
import { alertGroupsOf, type AlertPackageGroup } from "@/pipeline/alert-groups";
import { showReviewedParam, splitReviewed } from "@/pipeline/alert-review";
import {
  ALERT_SECTIONS,
  alertSectionOf,
  fixedSince,
  recentlyResolved,
  repoConnections,
  resolvedPackages,
  resolvedSince,
  type AlertSection,
} from "@/pipeline/alert-sections";
import { ago } from "@/pipeline/home";
import { weekStartOf } from "@/pipeline/bulletin";
import { attachInstalls } from "@/pipeline/bulletin-view";

import {
  AlertList,
  AlertSectionNav,
  FixedSinceVisit,
  MarkBacklogReviewed,
  RecheckButton,
  ResolvedCounter,
  ResolvedList,
} from "./_client";

export const metadata: Metadata = { title: "Alerts · Briff" };

// Anchor targets land below the top bar and the sticky section bar.
const SECTION_ANCHOR = "scroll-mt-[calc(var(--bar-h,64px)+var(--section-nav-h,52px)+12px)]";

function advisories(groups: readonly AlertPackageGroup[]): number {
  return groups.reduce((n, g) => n + g.advisories.length, 0);
}

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireOrgContext();
  const showReviewed = showReviewedParam((await searchParams).reviewed);
  // The previous visit decides what counts as "fixed since your last visit".
  const { alertsSeenAt: lastVisit } = await loadMemberState(getDb(), ctx.orgId, ctx.userId);
  // Opening Alerts clears the top bar's dot; the shell below reads the new time.
  await markAlertsSeen(getDb(), ctx.orgId, ctx.userId);
  const scope = await loadStreamScope(ctx.orgId);
  const db = withOrg(getDb(), ctx.orgId);
  const t = strings(PRODUCT_LANGUAGE);
  const weekStart = weekStartOf(new Date());

  const [allRows, repos, installations] = await Promise.all([
    db.alert.findMany({
      where: { repo: repoScope(scope) },
      select: {
        repoId: true,
        kind: true,
        createdAt: true,
        reviewedAt: true,
        resolvedAt: true,
        resolvedBy: true,
        repo: { select: { name: true } },
        advisory: {
          select: {
            osvId: true,
            severity: true,
            summary: true,
            aliases: true,
            affected: true,
            fixedVersion: true,
            package: { select: { id: true, name: true, ecosystem: true } },
          },
        },
      },
    }),
    db.repo.findMany({
      where: repoScope(scope),
      select: { name: true, githubInstallationId: true, lastScannedAt: true },
    }),
    activeInstallationIds(getDb(), ctx.orgId),
  ]);
  const repoCount = repos.length;
  const githubRepos = repos.filter((r) => r.githubInstallationId !== null).length;
  const scannerRepoRows = repos.filter((r) => r.githubInstallationId === null);
  const lastUploadAt = scannerRepoRows.reduce<Date | null>(
    (max, r) => (r.lastScannedAt && (!max || r.lastScannedAt > max) ? r.lastScannedAt : max),
    null
  );
  const connections = Object.fromEntries(
    [...repoConnections(repos)].map(([name, kinds]) => [name, [...kinds]])
  );
  const checking = await recheckInFlight(getDb(), ctx.orgId, installations);
  const now = new Date();
  // Resolved alerts (a later scan has no affected version) leave the lists. The Resolved
  // section and "Fixed since your last visit" read the same 30-day list.
  const rows = allRows.filter((r) => r.resolvedAt === null);
  const resolvedRows = recentlyResolved(allRows, now);
  const fixed = fixedSince(resolvedRows, lastVisit, weekStart);
  const resolved = resolvedPackages(resolvedRows);
  const resolvedThisWeek = resolvedSince(resolvedRows, weekStart);
  const baseImages = await loadBaseImageGroups(getDb(), ctx.orgId, repoScope(scope));
  const withInstalls = await attachInstalls(db, rows);
  const wording = {
    noLineFix: t.no_line_fix,
    fixedIn: t.fixed,
    transitive: "update the packages that pull it in",
  };
  // Reviewed first-scan backlog is hidden unless asked for; new alerts never are.
  const { open, reviewed } = splitReviewed(withInstalls);
  const inSection = (section: AlertSection) =>
    alertGroupsOf(
      open.filter((r) => alertSectionOf(r, weekStart) === section),
      wording
    );
  const thisWeek = inSection("this-week");
  const earlier = inSection("earlier");
  const backlog = inSection("backlog");
  const groupsOf: Record<AlertSection, AlertPackageGroup[]> = {
    "this-week": thisWeek,
    earlier,
    backlog,
  };
  // "New this week" always shows; the others when they list something or a fix.
  const shown = (section: AlertSection) =>
    section === "this-week" || groupsOf[section].length > 0 || fixed[section].length > 0;
  const navSections = [
    ...ALERT_SECTIONS.filter((s) => shown(s.id)).map((s) => ({
      ...s,
      count: groupsOf[s.id].length,
    })),
    { id: "resolved", label: "Resolved", count: resolved.length },
  ];
  const scanCommand = `npx briff-scan@${SCANNER_MAJOR}`;
  const listProps = { connections, scanCommand };
  const apiUrl = getEnv().BETTER_AUTH_URL.replace(/\/$/, "");
  const reviewedGroups = alertGroupsOf(reviewed, wording);
  const scopeName = scope.current?.name ?? "all streams";

  return (
    <AppShell ctx={ctx} active="/alerts">
      <PageHeader
        eyebrow={`${plural(repoCount, "repo")} · ${scopeName}`}
        title="Alerts"
        sub="Same-day emails when a new critical or high advisory hits a package you run, plus the backlog from your first scan."
        actions={
          allRows.length > 0 || repoCount > 0 ? (
            <>
              <ResolvedCounter count={resolvedThisWeek} />
              <RecheckButton
                githubRepos={installations.length > 0 ? githubRepos : 0}
                scannerRepos={scannerRepoRows.length}
                lastUpload={lastUploadAt ? ago(now, lastUploadAt) : null}
                initialChecking={checking}
                command={localScanCommands(apiUrl, "<token>").upload}
                docsUrl={`${SOURCE_URL}/blob/main/docs/SCANNER.md`}
              />
            </>
          ) : undefined
        }
      />
      {/* One stack for every section, so each gets the same gap and container width. */}
      <div className="flex flex-col gap-8">
        {rows.length > 0 || resolvedRows.length > 0 ? (
          <AlertSectionNav sections={navSections} />
        ) : null}
        <BaseImageAdvisories groups={baseImages} />
        {rows.length === 0 &&
        resolvedRows.length === 0 &&
        baseImages.length > 0 ? null : rows.length === 0 && resolvedRows.length === 0 ? (
          <Card className="rise [--i:1]">
            <EmptyState
              icon={<ShieldCheck strokeWidth={1.4} />}
              title="No advisories"
              action={<ConnectReposButton />}
            >
              When a package in one of {scopeName}&apos;s repos gets a security advisory, it shows
              up here, and critical or high ones reach your inbox the same day.
            </EmptyState>
          </Card>
        ) : (
          <>
            <section id="this-week" className={`rise [--i:1] ${SECTION_ANCHOR}`}>
              <SectionHeader title="New this week" count={plural(thisWeek.length, "package")} />
              <FixedSinceVisit packages={fixed["this-week"]} />
              {thisWeek.length > 0 ? (
                <AlertList groups={thisWeek} {...listProps} />
              ) : (
                <Card className="text-fg-muted px-[18px] py-5">
                  No new advisories since Monday.
                </Card>
              )}
            </section>
            {shown("earlier") && (
              <section id="earlier" className={`rise [--i:2] ${SECTION_ANCHOR}`}>
                <SectionHeader
                  title="Earlier"
                  count={`${plural(advisories(earlier), "advisory", "advisories")} · ${plural(earlier.length, "package")}`}
                />
                <FixedSinceVisit packages={fixed.earlier} />
                {earlier.length > 0 && (
                  <AlertList groups={earlier} filters initialLimit={10} {...listProps} />
                )}
              </section>
            )}
            {shown("backlog") && (
              <section id="backlog" className={`rise [--i:3] ${SECTION_ANCHOR}`}>
                <SectionHeader
                  title="First-scan backlog"
                  count={`${plural(advisories(backlog), "advisory", "advisories")} · ${plural(backlog.length, "package")}`}
                  action={backlog.length > 0 ? <MarkBacklogReviewed /> : undefined}
                />
                <FixedSinceVisit packages={fixed.backlog} />
                <p className="text-fg-muted mb-3.5 max-w-[72ch] text-[13px]">
                  Known advisories found the first time a repo was scanned. They were summed up in
                  one email, not sent one by one. Mark them as reviewed once you have looked; new
                  advisories always stay listed.
                </p>
                {backlog.length > 0 && (
                  <AlertList groups={backlog} filters initialLimit={25} review {...listProps} />
                )}
              </section>
            )}
            {reviewedGroups.length > 0 && !showReviewed && (
              <p className="rise text-fg-muted text-[13px] [--i:4]">
                {plural(
                  advisories(reviewedGroups),
                  "reviewed backlog advisory",
                  "reviewed backlog advisories"
                )}{" "}
                hidden.{" "}
                <Link href="/alerts?reviewed=1" className="text-brand font-medium hover:underline">
                  Show reviewed
                </Link>
              </p>
            )}
            {reviewedGroups.length > 0 && showReviewed && (
              <section className="rise [--i:4]">
                <SectionHeader
                  title="Reviewed backlog"
                  count={`${plural(advisories(reviewedGroups), "advisory", "advisories")} · ${plural(reviewedGroups.length, "package")}`}
                  action={
                    <Link href="/alerts" className="text-brand hover:underline">
                      Hide reviewed
                    </Link>
                  }
                />
                <AlertList groups={reviewedGroups} filters initialLimit={25} {...listProps} />
              </section>
            )}
            <details id="resolved" className={`group/resolved rise [--i:5] ${SECTION_ANCHOR}`}>
              <summary className="cursor-pointer list-none marker:content-none">
                <SectionHeader
                  title="Resolved"
                  count={`${plural(resolved.length, "package")} · last 30 days`}
                  action={
                    <span className="text-brand">
                      <span className="group-open/resolved:hidden">Show</span>
                      <span className="hidden group-open/resolved:inline">Hide</span>
                    </span>
                  }
                />
              </summary>
              <ResolvedList packages={resolved} />
            </details>
          </>
        )}
      </div>
    </AppShell>
  );
}
