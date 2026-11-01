import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { AppShell } from "@/components/shell/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FilterLinks } from "@/components/ui/filter-chips";
import { PageHeader } from "@/components/ui/section-header";
import { TruncatedText } from "@/components/ui/tooltip";
import { requireAdminContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { envWarnings } from "@/lib/env";
import { plural } from "@/lib/format";
import { caps } from "@/lib/i18n";
import { loadJobHealth } from "@/lib/ops/health";
import { loadOrgDirectory } from "@/lib/org-directory";
import {
  customLimits,
  ORG_PAGE_SIZE,
  orgHref,
  orgPage,
  parseOrgQuery,
  type OrgFilter,
  type OrgRow,
} from "@/lib/org-directory-view";
import { cn } from "@/lib/utils";

import { EditLimitsButton, OrgSearch, TestEmailButton } from "./_client";

export const metadata: Metadata = { title: "Admin · Briff" };

const RUNS_WINDOW_DAYS = 7;

function Stat({ value, caption }: { value: number; caption: string }) {
  return (
    <div className="bg-surface border-line rounded-tile border px-3.5 pt-3.5 pb-3">
      <b className="type-stat text-fg block tabular-nums">{value}</b>
      <span className="text-fg-muted mt-2 block text-[12px] leading-[1.3]">{caption}</span>
    </div>
  );
}

/** "4 / 10", in ochre with the words "at limit" once the limit is reached. */
function Usage({ used, limit }: { used: number; limit: number }) {
  const full = used >= limit;
  return (
    <span className={cn("tabular-nums", full && "text-upgrade font-medium")}>
      {used} / {limit}
      {full && <span className="ml-1.5 text-[12px]">at limit</span>}
    </span>
  );
}

const TH = "bg-surface-2 text-fg-muted type-label px-3.5 py-2.5 text-left whitespace-nowrap";
const TD =
  "group-hover/row:bg-surface-2 border-line border-t px-3.5 py-2.5 whitespace-nowrap transition-colors";

function OrgTable({ rows }: { rows: OrgRow[] }) {
  return (
    <div className="bg-surface border-line rounded-card overflow-x-auto border">
      <table className="w-full min-w-[820px] border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr>
            <th scope="col" className={cn(TH, "border-line sticky left-0 z-1 border-r")}>
              {caps("Organisation")}
            </th>
            <th scope="col" className={TH}>
              {caps("Owner")}
            </th>
            <th scope="col" className={TH}>
              {caps("Members")}
            </th>
            <th scope="col" className={TH}>
              {caps("Repos used")}
            </th>
            <th scope="col" className={TH}>
              {caps("Streams used")}
            </th>
            <th scope="col" className={TH}>
              {caps("Created")}
            </th>
            <th scope="col" className={cn(TH, "max-[767px]:hidden")}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((org) => (
            <tr key={org.id} className="group/row">
              <th
                scope="row"
                className="bg-surface group-hover/row:bg-surface-2 border-line sticky left-0 z-1 max-w-[220px] border-t border-r px-3.5 py-2.5 text-left font-medium transition-colors"
              >
                <TruncatedText>{org.name}</TruncatedText>
                {customLimits(org) && (
                  <span className="text-fg-muted block text-[12px] font-normal">custom limits</span>
                )}
                <span className="mt-1.5 block min-[768px]:hidden">
                  <EditLimitsButton org={org} />
                </span>
              </th>
              <td className={cn(TD, "text-fg-muted max-w-[240px]")}>
                <TruncatedText>{org.ownerEmail ?? "no owner"}</TruncatedText>
              </td>
              <td className={cn(TD, "tabular-nums")}>{org.members}</td>
              <td className={TD}>
                <Usage used={org.repos} limit={org.repoLimit} />
              </td>
              <td className={TD}>
                <Usage used={org.streams} limit={org.streamLimit} />
              </td>
              <td className={cn(TD, "text-fg-muted tabular-nums")}>
                {org.createdAt.toISOString().slice(0, 10)}
              </td>
              <td className={cn(TD, "py-1.5 text-right max-[767px]:hidden")}>
                <EditLimitsButton org={org} />
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="text-fg-muted border-line border-t px-3.5 py-5">
                No organisation matches.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireAdminContext();
  const db = getDb();
  const query = parseOrgQuery(await searchParams);
  const now = new Date();
  const since = new Date(now.getTime() - RUNS_WINDOW_DAYS * 86_400_000);
  const [orgs, users, failedRuns, health] = await Promise.all([
    loadOrgDirectory(db),
    db.user.count(),
    db.run.count({ where: { status: "failed", startedAt: { gte: since } } }),
    loadJobHealth(db, now),
  ]);
  const totals = orgs.reduce(
    (sum, o) => ({ repos: sum.repos + o.repos, streams: sum.streams + o.streams }),
    { repos: 0, streams: 0 }
  );
  const page = orgPage(orgs, query);
  const warnings = envWarnings();
  const runsLine = [
    failedRuns === 0
      ? `No failed runs in the last ${RUNS_WINDOW_DAYS} days`
      : `${plural(failedRuns, "failed run")} in the last ${RUNS_WINDOW_DAYS} days`,
    health.stale.length > 0 ? `overdue: ${health.stale.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("; ");
  const filters: { value: OrgFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "at-limit", label: "At limit" },
    { value: "custom", label: "Custom limits" },
  ];
  const first = (page.page - 1) * ORG_PAGE_SIZE + 1;

  return (
    <AppShell ctx={ctx} active="/admin">
      <PageHeader
        eyebrow="This instance"
        title="Admin"
        sub="Who uses this instance, what the worker did, and organisation limits."
      />
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-2 min-[560px]:grid-cols-4">
          <Stat value={users} caption={users === 1 ? "user" : "users"} />
          <Stat
            value={orgs.length}
            caption={orgs.length === 1 ? "organisation" : "organisations"}
          />
          <Stat value={totals.repos} caption={totals.repos === 1 ? "repo" : "repos"} />
          <Stat value={totals.streams} caption={totals.streams === 1 ? "stream" : "streams"} />
        </div>

        <Link
          href="/admin/runs"
          className="group bg-surface border-line hover:border-brand hover:shadow-lift ease-entrance rounded-card flex items-center gap-4 border p-[18px] transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 max-[560px]:p-[15px]"
        >
          <span className="flex min-w-0 flex-col gap-1">
            <span className="type-h2 text-fg">Runs</span>
            <span className="text-fg-muted text-[13.5px]">
              Every job&apos;s runs, errors and a Run now button. {runsLine}.
            </span>
          </span>
          <ArrowRight aria-hidden className="text-brand ml-auto size-5 shrink-0" />
        </Link>

        {warnings.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="text-upgrade list-disc pl-4 text-[13.5px]">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <section id="organisations" className="mt-5 grid scroll-mt-24 gap-3">
          <div>
            <h2 className="type-h2">Organisations</h2>
            <p className="text-fg-muted mt-1 max-w-[72ch] text-[13.5px]">
              The instance admin view: every organisation on this instance and its repository and
              stream limits (10 and 2 by default; Edit limits raises them for one organisation).
              Only the instance admin, the first account, sees it; on a self-hosted instance this is
              usually just your own organisation.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterLinks
              label="Filter organisations"
              options={filters.map((f) => ({
                href: orgHref({ q: query.q, filter: f.value, page: 1 }),
                label: f.label,
                count: page.counts[f.value],
                current: f.value === query.filter,
              }))}
            />
            <OrgSearch
              initial={query.q}
              hrefFor={orgHref({ q: "", filter: query.filter, page: 1 })}
            />
          </div>
          <OrgTable rows={page.rows} />
          <div className="text-fg-muted flex flex-wrap items-center justify-between gap-2 text-[13px] tabular-nums">
            <span>
              {page.total === 0
                ? "No organisations"
                : page.pages === 1
                  ? `${plural(page.total, "organisation")}, newest first`
                  : `${first}–${first + page.rows.length - 1} of ${page.total}, newest first`}
            </span>
            {page.pages > 1 && (
              <nav aria-label="Organisation pages" className="flex items-center gap-3">
                {page.page > 1 ? (
                  <Link
                    href={orgHref({ ...query, page: page.page - 1 })}
                    className="text-brand font-medium hover:underline"
                  >
                    ← Previous
                  </Link>
                ) : (
                  <span className="text-fg-subtle">← Previous</span>
                )}
                <span>
                  Page {page.page} of {page.pages}
                </span>
                {page.page < page.pages ? (
                  <Link
                    href={orgHref({ ...query, page: page.page + 1 })}
                    className="text-brand font-medium hover:underline"
                  >
                    Next →
                  </Link>
                ) : (
                  <span className="text-fg-subtle">Next →</span>
                )}
              </nav>
            )}
          </div>
        </section>

        <Card className="mt-5">
          <CardHeader>
            <CardTitle>Email</CardTitle>
            <CardDescription>Checks the SMTP settings with a message to you.</CardDescription>
          </CardHeader>
          <CardContent className="sm:max-w-xs">
            <TestEmailButton />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
