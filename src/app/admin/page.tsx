import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { AppShell } from "@/components/shell/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/section-header";
import { requireAdminContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { envWarnings } from "@/lib/env";
import { plural } from "@/lib/format";
import { loadJobHealth } from "@/lib/ops/health";

import { LimitsForm, TestEmailButton } from "./_client";

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

export default async function AdminPage() {
  const ctx = await requireAdminContext();
  const db = getDb();
  const now = new Date();
  const since = new Date(now.getTime() - RUNS_WINDOW_DAYS * 86_400_000);
  const [organisations, users, failedRuns, health] = await Promise.all([
    db.org.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, repoLimit: true, streamLimit: true },
    }),
    db.user.count(),
    db.run.count({ where: { status: "failed", startedAt: { gte: since } } }),
    loadJobHealth(db, now),
  ]);
  // Tenant counts go through each org's own layer; an instance has a handful of orgs.
  const orgs = await Promise.all(
    organisations.map(async (org) => {
      const scoped = withOrg(db, org.id);
      const [repos, streams, members] = await Promise.all([
        scoped.repo.count(),
        scoped.bulletinStream.count(),
        scoped.orgMember.count(),
      ]);
      return { ...org, repos, streams, members };
    })
  );
  const totals = orgs.reduce(
    (sum, o) => ({ repos: sum.repos + o.repos, streams: sum.streams + o.streams }),
    { repos: 0, streams: 0 }
  );
  const warnings = envWarnings();
  const runsLine = [
    failedRuns === 0
      ? `No failed runs in the last ${RUNS_WINDOW_DAYS} days`
      : `${plural(failedRuns, "failed run")} in the last ${RUNS_WINDOW_DAYS} days`,
    health.stale.length > 0 ? `overdue: ${health.stale.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("; ");

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

        <Card>
          <CardHeader>
            <CardTitle>Organisations</CardTitle>
            <CardDescription>
              Members, repositories and streams per organisation; raise its limits here.
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-line grid divide-y">
            {orgs.map((org) => (
              <div key={org.id} className="py-4 first:pt-0 last:pb-0">
                <LimitsForm
                  org={org}
                  meta={`${plural(org.members, "member")} · ${org.repos} of ${org.repoLimit} repos · ${org.streams} of ${org.streamLimit} streams`}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
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
