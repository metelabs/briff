import { BookMarked, CircleAlert, CircleCheck } from "lucide-react";
import type { Metadata } from "next";

import { AppShell } from "@/components/shell/app-shell";
import { ConnectReposButton } from "@/components/shell/connect-sheet";
import { Card } from "@/components/ui/card";
import { FilterLinks } from "@/components/ui/filter-chips";
import { EmptyState, PageHeader } from "@/components/ui/section-header";
import { requireOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { plural, shortDateTime } from "@/lib/format";
import { dependencySummary, isNewRepo, runtimeChips } from "@/lib/repos";
import { GITHUB_FLOW_MESSAGES, isGithubFlowStatus } from "@/lib/github/status";
import { loadStreamScope } from "@/lib/stream-scope";

import { RepoList, type RepoListRow } from "./_client";

export const metadata: Metadata = { title: "Repos · Briff" };

type Show = "stream" | "all" | "none";

export default async function ReposPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireOrgContext();
  const query = await searchParams;
  // Set by the GitHub App routes on their way back (src/lib/github/status.ts).
  const githubStatus = isGithubFlowStatus(query.github) ? GITHUB_FLOW_MESSAGES[query.github] : null;
  const scope = await loadStreamScope(ctx.orgId);
  const limits = await getDb().org.findUniqueOrThrow({
    where: { id: ctx.orgId },
    select: { githubRepoLimitReached: true, repoLimit: true },
  });
  const db = withOrg(getDb(), ctx.orgId);
  const [repos, direct, open, otherEcosystems] = await Promise.all([
    db.repo.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        source: true,
        includedChangedAt: true,
        firstSeenAt: true,
        lastScannedAt: true,
        githubInstallationId: true,
        _count: { select: { dependencies: true } },
        streams: { select: { streamId: true } },
        runtimes: {
          select: {
            name: true,
            version: true,
            normalized: true,
            source: true,
            unresolved: true,
            constraint: true,
          },
        },
      },
    }),
    db.dependency.groupBy({ by: ["repoId"], where: { direct: true }, _count: { _all: true } }),
    db.alert.groupBy({
      by: ["repoId"],
      where: { kind: "new", resolvedAt: null },
      _count: { _all: true },
    }),
    // Only the non-npm rows: npm is the rest of each repo's counts.
    db.dependency.findMany({
      where: { package: { ecosystem: { not: "npm" } } },
      select: { repoId: true, direct: true, package: { select: { ecosystem: true } } },
    }),
  ]);
  type Counts = { direct: number; total: number };
  const otherByRepo = new Map<string, Map<string, Counts>>();
  for (const d of otherEcosystems) {
    const byEcosystem = otherByRepo.get(d.repoId) ?? new Map<string, Counts>();
    const count = byEcosystem.get(d.package.ecosystem) ?? { direct: 0, total: 0 };
    count.total++;
    if (d.direct) count.direct++;
    byEcosystem.set(d.package.ecosystem, count);
    otherByRepo.set(d.repoId, byEcosystem);
  }
  const depsLine = (repoId: string, direct: number, total: number) => {
    const others = [...(otherByRepo.get(repoId) ?? new Map<string, Counts>()).entries()].map(
      ([ecosystem, c]) => ({
        ecosystem,
        ...c,
      })
    );
    const npm = {
      ecosystem: "npm",
      direct: direct - others.reduce((n, c) => n + c.direct, 0),
      total: total - others.reduce((n, c) => n + c.total, 0),
    };
    return dependencySummary([npm, ...others]);
  };
  const directByRepo = new Map(direct.map((d) => [d.repoId, d._count._all]));
  const openByRepo = new Map(open.map((d) => [d.repoId, d._count._all]));
  const inStream = (r: (typeof repos)[number]) =>
    scope.current !== null && r.streams.some((s) => s.streamId === scope.current?.id);
  const inNone = repos.filter((r) => r.streams.length === 0);
  const requested: Show = query.show === "all" ? "all" : query.show === "none" ? "none" : "stream";
  const show: Show = requested === "stream" && !scope.current ? "all" : requested;
  const visible =
    show === "all" ? repos : show === "none" ? inNone : repos.filter((r) => inStream(r));
  const lastScan = repos.reduce<Date | null>(
    (latest, r) =>
      r.lastScannedAt && (!latest || r.lastScannedAt > latest) ? r.lastScannedAt : latest,
    null
  );
  const rows: RepoListRow[] = visible.map((r) => ({
    id: r.id,
    name: r.name,
    source:
      r.source === "local" ? "Local scanner" : r.githubInstallationId ? "GitHub App" : "GitHub",
    scanner: r.source === "local" ? "local" : "github",
    isNew: isNewRepo(r),
    inNoStream: r.streams.length === 0,
    deps: depsLine(r.id, directByRepo.get(r.id) ?? 0, r._count.dependencies),
    chips: runtimeChips(r.runtimes),
    openAlerts: openByRepo.get(r.id) ?? 0,
    // Alerts shows the current stream only; elsewhere the count is not a link.
    alertsInScope: scope.current === null || inStream(r),
    lastScan: r.lastScannedAt ? shortDateTime(r.lastScannedAt) : "never",
  }));
  const filters = [
    ...(scope.current
      ? [
          {
            href: "/repos",
            label: scope.current.name,
            count: repos.filter((r) => inStream(r)).length,
            current: show === "stream",
          },
        ]
      : []),
    { href: "/repos?show=all", label: "All repos", count: repos.length, current: show === "all" },
    {
      href: "/repos?show=none",
      label: "In no stream",
      count: inNone.length,
      current: show === "none",
    },
  ];

  return (
    <AppShell ctx={ctx} active="/repos">
      {limits.githubRepoLimitReached && (
        <p role="status" className="text-upgrade mb-4 text-[13px]">
          Some GitHub repositories were previously left unlinked at capacity. Current repository
          limit: {limits.repoLimit}. Rescan the installation after freeing space or asking the
          instance admin to raise the limit.
        </p>
      )}
      <PageHeader
        title="Repos"
        sub={
          repos.length === 0
            ? "Repos you scan appear here with what they run."
            : `${plural(repos.length, "repo")}${lastScan ? ` · last scan ${shortDateTime(lastScan)}` : ""}`
        }
        actions={<ConnectReposButton variant="secondary" />}
      />
      {githubStatus && (
        <p
          role="status"
          className="rise bg-surface border-line rounded-card mb-4 flex items-start gap-2.5 border px-4 py-3 text-[13.5px] [--i:1]"
        >
          {githubStatus.ok ? (
            <CircleCheck aria-hidden className="text-ok mt-0.5 size-4 shrink-0" />
          ) : (
            <CircleAlert aria-hidden className="text-upgrade mt-0.5 size-4 shrink-0" />
          )}
          {githubStatus.text}
        </p>
      )}
      {repos.length === 0 ? (
        <Card className="rise [--i:1]">
          <EmptyState
            icon={<BookMarked strokeWidth={1.4} />}
            title="No repos yet"
            action={<ConnectReposButton>Connect your first repo</ConnectReposButton>}
          >
            Connect GitHub, or run the scanner once. Each repo shows up here after its first scan.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="rise mb-3.5 [--i:1]">
            <FilterLinks label="Which repos" options={filters} />
          </div>
          <RepoList rows={rows} />
        </>
      )}
    </AppShell>
  );
}
