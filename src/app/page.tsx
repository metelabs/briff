import { ArrowRight, Layers } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";

import { AppShell } from "@/components/shell/app-shell";
import { ConnectReposButton } from "@/components/shell/connect-sheet";
import { Card } from "@/components/ui/card";
import { AttentionSparkline, SeverityBar } from "@/components/ui/charts";
import { EmptyState, PageHeader, SectionHeader, WeekPill } from "@/components/ui/section-header";
import { requireOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { plural, shortDate, shortDateTime } from "@/lib/format";
import { shouldOnboard } from "@/lib/member-state";
import { loadDrift } from "@/lib/stack-load";
import { loadStreamScope, repoScope } from "@/lib/stream-scope";
import { cn } from "@/lib/utils";
import { isoWeekLabel, weekStartOf } from "@/pipeline/bulletin";
import { splitReviewed } from "@/pipeline/alert-review";
import { sectionOf } from "@/pipeline/bulletin-view";
import { membershipFlashQuery } from "@/lib/flash";
import { attentionSeries, lastWeeks, nextBulletinAt, severitySplit } from "@/pipeline/home";

export const metadata: Metadata = { title: "Home · Briff" };

interface Counts {
  act: number;
  securityAct: number;
  know: number;
}

/**
 * Home: one overview with a way into every page. Bulletins per stream (all streams), then
 * alerts, stack health and repos for the stream chosen in the top bar, then what Briff did.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireOrgContext();
  // Onboarding is shown once, on the first run; after that the top bar's sheet connects repos.
  if (await shouldOnboard(getDb(), ctx.orgId, ctx.userId)) {
    redirect(`/onboarding${membershipFlashQuery(await searchParams)}`);
  }

  const now = new Date();
  const weeks = lastWeeks(now);
  const thisWeek = weekStartOf(now);
  const scope = await loadStreamScope(ctx.orgId);
  const db = withOrg(getDb(), ctx.orgId);
  const [streams, bulletins, alertRows, repos, { drift }] = await Promise.all([
    db.bulletinStream.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, _count: { select: { repos: true } } },
    }),
    // The sparklines' 12 weeks, uncapped (at most one bulletin per stream and week).
    db.bulletin.findMany({
      where: { preview: false, weekStart: { gte: weeks[0] } },
      orderBy: [{ weekStart: "desc" }, { createdAt: "desc" }],
      select: { id: true, streamId: true, weekStart: true, createdAt: true },
    }),
    db.alert.findMany({
      where: { repo: repoScope(scope), resolvedAt: null },
      select: {
        kind: true,
        createdAt: true,
        reviewedAt: true,
        advisoryId: true,
        advisory: { select: { severity: true } },
      },
    }),
    db.repo.findMany({ select: { included: true, lastScannedAt: true } }),
    loadDrift(ctx.orgId, scope),
  ]);

  // Each stream's latest bulletin, also when it is older than the 12 weeks.
  const latest = (
    await Promise.all(
      streams.map((st) =>
        db.bulletin.findFirst({
          where: { preview: false, streamId: st.id },
          orderBy: [{ weekStart: "desc" }, { createdAt: "desc" }],
          select: { id: true, streamId: true, weekStart: true, createdAt: true },
        })
      )
    )
  ).flatMap((b) => (b ? [b] : []));
  const countedIds = [...new Set([...bulletins, ...latest].map((b) => b.id))];
  const rows =
    countedIds.length > 0
      ? await db.bulletinItem.groupBy({
          by: ["bulletinId", "section", "bucket"],
          where: { bulletinId: { in: countedIds } },
          _count: { _all: true },
        })
      : [];
  const counts = new Map<string, Counts>();
  for (const row of rows) {
    const c = counts.get(row.bulletinId) ?? { act: 0, securityAct: 0, know: 0 };
    const section = sectionOf(row.section, row.bucket);
    if (section === "act") c.act += row._count._all;
    if (section === "know") c.know += row._count._all;
    if (section === "act" && row.bucket === "security") c.securityAct += row._count._all;
    counts.set(row.bulletinId, c);
  }
  const countsOf = (id: string): Counts => counts.get(id) ?? { act: 0, securityAct: 0, know: 0 };

  const streamCards = streams.map((s) => {
    const own = bulletins.filter((b) => b.streamId === s.id);
    const last = latest.find((b) => b.streamId === s.id) ?? null;
    return {
      stream: s,
      latest: last,
      counts: last ? countsOf(last.id) : null,
      current: last !== null && last.weekStart.getTime() === thisWeek.getTime(),
      series: attentionSeries(
        weeks,
        own.map((b) => ({ weekStart: b.weekStart, act: countsOf(b.id).act }))
      ),
    };
  });
  const current = streamCards.filter((c) => c.current && c.counts);
  const attention = current.reduce((n, c) => n + (c.counts?.act ?? 0), 0);
  const security = current.some((c) => (c.counts?.securityAct ?? 0) > 0);

  // Reviewed first-scan backlog stays out of every count here (alert-review.ts).
  const { open: alerts, reviewed: reviewedAlerts } = splitReviewed(alertRows);
  const reviewedBacklog = new Set(reviewedAlerts.map((a) => a.advisoryId)).size;
  const newThisWeek = new Set(
    alerts.filter((a) => a.kind === "new" && a.createdAt >= thisWeek).map((a) => a.advisoryId)
  ).size;
  const backlogAlerts = alerts
    .filter((a) => a.kind === "backlog")
    .map((a) => ({ advisoryId: a.advisoryId, severity: a.advisory.severity }));
  const backlog = severitySplit(backlogAlerts);
  const backlogTotal = new Set(backlogAlerts.map((a) => a.advisoryId)).size;
  const allAdvisories = new Set(alerts.map((a) => a.advisoryId)).size;

  const eolRepos = drift.filter((r) => r.eol);
  const behindRepos = drift.filter((r) => r.majorsBehind > 0);
  const unassigned = repos.filter((r) => !r.included).length;
  const lastScan = repos.reduce<Date | null>(
    (latest, r) =>
      r.lastScannedAt && (!latest || r.lastScannedAt > latest) ? r.lastScannedAt : latest,
    null
  );
  const lastBulletin = latest.reduce<(typeof latest)[number] | null>(
    (latest, b) => (!latest || b.createdAt > latest.createdAt ? b : latest),
    null
  );
  const scopeName = scope.current?.name ?? "all streams";

  return (
    <AppShell ctx={ctx} active="/">
      <PageHeader
        eyebrow={
          <>
            <WeekPill>{isoWeekLabel(now)}</WeekPill>
            <span>{shortDate(now)}</span>
          </>
        }
        title={
          repos.length === 0 ? (
            "Nothing to brief on yet."
          ) : current.length === 0 ? (
            "No bulletin this week yet."
          ) : attention === 0 ? (
            "Nothing needs your attention this week."
          ) : (
            <>
              <span className={security ? "text-sec" : undefined}>{plural(attention, "item")}</span>{" "}
              {attention === 1 ? "needs" : "need"} your attention this week.
            </>
          )
        }
        sub={
          repos.length === 0
            ? "Connect a repo and Briff starts watching its packages and runtimes."
            : `Across ${plural(streams.length, "stream")}. Alerts, stack and repos below follow ${scopeName}, the stream picked in the top bar.`
        }
      />

      {repos.length === 0 ? (
        <Card className="rise [--i:1]">
          <EmptyState
            icon={<Layers strokeWidth={1.4} />}
            title="Nothing scanned yet"
            action={<ConnectReposButton />}
          >
            Once a scan arrives, this page shows each stream&apos;s bulletin, your security alerts
            and how far your stack is behind.
          </EmptyState>
        </Card>
      ) : (
        <>
          <section className="rise [--i:1]">
            <SectionHeader
              title="Bulletins"
              count={streams.length}
              action={<MoreLink href="/bulletins">All bulletins</MoreLink>}
            />
            <div className="grid gap-3 min-[768px]:grid-cols-2 min-[1100px]:grid-cols-3">
              {streamCards.map((c, i) => (
                <StreamCard key={c.stream.id} card={c} weeks={weeks} index={i} />
              ))}
            </div>
          </section>

          <div className="mt-8 grid items-start gap-3 min-[980px]:grid-cols-3">
            <Tile index={2} title="Alerts" href="/alerts" linkLabel="Open Alerts">
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <Stat value={newThisWeek} caption="new this week" alarm={newThisWeek > 0} />
                <Stat value={backlogTotal} caption="in the backlog" />
              </div>
              {backlogTotal > 0 ? (
                <div className="mt-4">
                  <p className="text-fg-muted mb-2 text-[12.5px]">Backlog by severity</p>
                  <SeverityBar counts={backlog} />
                </div>
              ) : (
                <p className="text-fg-muted mt-3 text-[13px]">
                  {reviewedBacklog > 0
                    ? `First-scan backlog reviewed (${plural(reviewedBacklog, "advisory", "advisories")}).${allAdvisories > 0 ? ` ${plural(allAdvisories, "other advisory", "other advisories")} on Alerts.` : ""}`
                    : allAdvisories === 0
                      ? `No advisory for ${scopeName}'s repos.`
                      : `No first-scan backlog; ${plural(allAdvisories, "advisory", "advisories")} in total on Alerts.`}
                </p>
              )}
            </Tile>

            <Tile index={3} title="Stack health" href="/stack" linkLabel="Open Stack">
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <Stat
                  value={eolRepos.length}
                  caption="on an end-of-life runtime"
                  alarm={eolRepos.length > 0}
                />
                <Stat value={behindRepos.length} caption="a major version behind" />
              </div>
              <RepoNames
                className="mt-3"
                label="End-of-life"
                names={eolRepos.map((r) => r.repo)}
                fallback={
                  drift.length === 0
                    ? `No repo in ${scopeName} yet.`
                    : "Every runtime is on a supported line."
                }
              />
            </Tile>

            <Tile index={4} title="Repos" href="/repos" linkLabel="Open Repos">
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <Stat value={repos.length} caption="scanned" />
                <Stat value={unassigned} caption="in no stream" />
              </div>
              <p className="text-fg-muted mt-3 text-[13px]">
                {unassigned > 0 ? (
                  <>
                    Repos in no stream get no bulletin or alerts.{" "}
                    <Link href="/streams" className="text-brand underline-offset-4 hover:underline">
                      Add them to a stream
                    </Link>
                  </>
                ) : (
                  "Every repo is in a stream."
                )}
              </p>
            </Tile>
          </div>
        </>
      )}

      <section
        aria-label="What Briff did"
        className="rise text-fg-muted border-line mt-8 flex flex-wrap gap-x-6 gap-y-1.5 border-t pt-4 text-[13px] [--i:5]"
      >
        <span>
          Last scan{" "}
          <b className="text-fg font-medium">{lastScan ? shortDateTime(lastScan) : "none yet"}</b>
        </span>
        <span>
          Last bulletin{" "}
          {lastBulletin ? (
            <Link href={`/b/${lastBulletin.id}`} className="text-fg font-medium hover:underline">
              {shortDateTime(lastBulletin.createdAt)}
            </Link>
          ) : (
            <b className="text-fg font-medium">none yet</b>
          )}
        </span>
        <span>
          Next bulletin <b className="text-fg font-medium">{shortDateTime(nextBulletinAt(now))}</b>
        </span>
        <Link href="/streams" className="hover:text-fg ml-auto underline-offset-4 hover:underline">
          Streams
        </Link>
      </section>
    </AppShell>
  );
}

function MoreLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="text-brand inline-flex items-center gap-1 underline-offset-4 hover:underline"
    >
      {children}
      <ArrowRight aria-hidden className="size-3.5" />
    </Link>
  );
}

function Stat({
  value,
  caption,
  alarm = false,
}: {
  value: number;
  caption: string;
  alarm?: boolean;
}) {
  return (
    <div>
      <b className={cn("type-stat block", alarm ? "text-sec" : "text-fg")}>{value}</b>
      <span className="text-fg-muted mt-1.5 block text-[12px]">{caption}</span>
    </div>
  );
}

function Tile({
  title,
  href,
  linkLabel,
  index,
  children,
}: {
  title: string;
  href: string;
  linkLabel: string;
  index: number;
  children: ReactNode;
}) {
  return (
    <Card style={{ "--i": index } as CSSProperties} className="rise min-w-0 p-[18px]">
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <h2 className="type-h2">{title}</h2>
        <span className="text-[13px] font-medium">
          <MoreLink href={href}>{linkLabel}</MoreLink>
        </span>
      </div>
      {children}
    </Card>
  );
}

function RepoNames({
  names,
  label,
  fallback,
  className,
}: {
  names: string[];
  label: string;
  fallback: string;
  className?: string;
}) {
  if (names.length === 0)
    return <p className={cn("text-fg-muted text-[13px]", className)}>{fallback}</p>;
  const shown = names.slice(0, 3);
  return (
    <p className={cn("text-fg-muted text-[13px]", className)}>
      {label}: <span className="text-fg font-mono text-[12.5px]">{shown.join(", ")}</span>
      {names.length > shown.length && ` and ${names.length - shown.length} more`}
    </p>
  );
}

function StreamCard({
  card,
  weeks,
  index,
}: {
  card: {
    stream: { id: string; name: string; _count: { repos: number } };
    latest: { id: string; weekStart: Date } | null;
    counts: Counts | null;
    current: boolean;
    series: (number | null)[];
  };
  weeks: Date[];
  index: number;
}) {
  const { stream, latest, counts } = card;
  return (
    <Card
      style={{ "--i": index + 1 } as CSSProperties}
      className="rise flex min-w-0 flex-col p-[18px]"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="min-w-0 truncate text-[15px] font-semibold">{stream.name}</h3>
        {latest && <WeekPill>{isoWeekLabel(latest.weekStart).slice(5)}</WeekPill>}
      </div>
      {latest && counts ? (
        <>
          <div className="flex gap-6">
            <Stat value={counts.act} caption="need your attention" alarm={counts.securityAct > 0} />
            <Stat value={counts.know} caption="good to know" />
          </div>
          {!card.current && (
            <p className="text-fg-muted mt-2 text-[12.5px]">
              No bulletin this week yet; this is the latest.
            </p>
          )}
          <div className="mt-4">
            <p className="text-fg-muted mb-1 text-[12px]">Needs your attention, last 12 weeks</p>
            <AttentionSparkline
              weeks={weeks}
              values={card.series}
              label={`${stream.name}: items that needed your attention per week`}
            />
          </div>
          <div className="mt-auto pt-4 text-[13px] font-medium">
            <MoreLink href={`/b/${latest.id}`}>Open bulletin</MoreLink>
          </div>
        </>
      ) : (
        <p className="text-fg-muted text-[13px]">
          {stream._count.repos === 0
            ? "No repos in this stream yet, so no bulletin."
            : "No bulletin yet. The first one arrives Monday 04:00 UTC."}
          {stream._count.repos === 0 && (
            <>
              {" "}
              <Link
                href={`/streams?stream=${encodeURIComponent(stream.id)}`}
                className="text-brand underline-offset-4 hover:underline"
              >
                Pick repos
              </Link>
            </>
          )}
        </p>
      )}
    </Card>
  );
}
