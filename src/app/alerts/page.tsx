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
import { markAlertsSeen } from "@/lib/member-state";
import { PRODUCT_LANGUAGE, strings } from "@/lib/i18n";
import { loadStreamScope, repoScope } from "@/lib/stream-scope";
import { alertGroupsOf, type AlertPackageGroup } from "@/pipeline/alert-groups";
import { showReviewedParam, splitReviewed } from "@/pipeline/alert-review";
import { weekStartOf } from "@/pipeline/bulletin";
import { attachInstalls } from "@/pipeline/bulletin-view";

import { AlertList, MarkBacklogReviewed } from "./_client";

export const metadata: Metadata = { title: "Alerts · Briff" };

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
  // Opening Alerts clears the top bar's dot; the shell below reads the new time.
  await markAlertsSeen(getDb(), ctx.orgId, ctx.userId);
  const scope = await loadStreamScope(ctx.orgId);
  const db = withOrg(getDb(), ctx.orgId);
  const t = strings(PRODUCT_LANGUAGE);
  const weekStart = weekStartOf(new Date());

  const [rows, repoCount] = await Promise.all([
    db.alert.findMany({
      where: { repo: repoScope(scope) },
      select: {
        repoId: true,
        kind: true,
        createdAt: true,
        reviewedAt: true,
        repo: { select: { name: true } },
        advisory: {
          select: {
            osvId: true,
            severity: true,
            summary: true,
            affected: true,
            fixedVersion: true,
            package: { select: { id: true, name: true, ecosystem: true } },
          },
        },
      },
    }),
    db.repo.count({ where: repoScope(scope) }),
  ]);
  const withInstalls = await attachInstalls(db, rows);
  const wording = {
    noLineFix: t.no_line_fix,
    fixedIn: t.fixed,
    transitive: "update the packages that pull it in",
  };
  // Reviewed first-scan backlog is hidden unless asked for; new alerts never are.
  const { open, reviewed } = splitReviewed(withInstalls);
  const thisWeek = alertGroupsOf(
    open.filter((r) => r.kind === "new" && r.createdAt >= weekStart),
    wording
  );
  const earlier = alertGroupsOf(
    open.filter((r) => r.kind === "new" && r.createdAt < weekStart),
    wording
  );
  const backlog = alertGroupsOf(
    open.filter((r) => r.kind === "backlog"),
    wording
  );
  const reviewedGroups = alertGroupsOf(reviewed, wording);
  const scopeName = scope.current?.name ?? "all streams";

  return (
    <AppShell ctx={ctx} active="/alerts">
      <PageHeader
        eyebrow={`${plural(repoCount, "repo")} · ${scopeName}`}
        title="Alerts"
        sub="Same-day emails when a new critical or high advisory hits a package you run, plus the backlog from your first scan."
      />
      {rows.length === 0 ? (
        <Card className="rise [--i:1]">
          <EmptyState
            icon={<ShieldCheck strokeWidth={1.4} />}
            title="No advisories"
            action={<ConnectReposButton />}
          >
            When a package in one of {scopeName}&apos;s repos gets a security advisory, it shows up
            here, and critical or high ones reach your inbox the same day.
          </EmptyState>
        </Card>
      ) : (
        <>
          <section className="rise [--i:1]">
            <SectionHeader title="New this week" count={plural(thisWeek.length, "package")} />
            {thisWeek.length > 0 ? (
              <AlertList groups={thisWeek} />
            ) : (
              <Card className="text-fg-muted px-[18px] py-5">No new advisories since Monday.</Card>
            )}
          </section>
          {earlier.length > 0 && (
            <section className="rise mt-8 [--i:2]">
              <SectionHeader
                title="Earlier"
                count={`${plural(advisories(earlier), "advisory", "advisories")} · ${plural(earlier.length, "package")}`}
              />
              <AlertList groups={earlier} filters initialLimit={10} />
            </section>
          )}
          {backlog.length > 0 && (
            <section className="rise mt-8 [--i:3]">
              <SectionHeader
                title="First-scan backlog"
                count={`${plural(advisories(backlog), "advisory", "advisories")} · ${plural(backlog.length, "package")}`}
                action={<MarkBacklogReviewed />}
              />
              <p className="text-fg-muted mb-3.5 max-w-[72ch] text-[13px]">
                Known advisories found the first time a repo was scanned. They were summed up in one
                email, not sent one by one. Mark them as reviewed once you have looked; new
                advisories always stay listed.
              </p>
              <AlertList groups={backlog} filters initialLimit={25} review />
            </section>
          )}
          {reviewedGroups.length > 0 && !showReviewed && (
            <p className="rise text-fg-muted mt-6 text-[13px] [--i:4]">
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
            <section className="rise mt-8 [--i:4]">
              <SectionHeader
                title="Reviewed backlog"
                count={`${plural(advisories(reviewedGroups), "advisory", "advisories")} · ${plural(reviewedGroups.length, "package")}`}
                action={
                  <Link href="/alerts" className="text-brand hover:underline">
                    Hide reviewed
                  </Link>
                }
              />
              <AlertList groups={reviewedGroups} filters initialLimit={25} />
            </section>
          )}
        </>
      )}
    </AppShell>
  );
}
