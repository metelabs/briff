import { ArrowDown, ArrowRight, ArrowUp, CalendarClock, Layers } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";

import { AppShell } from "@/components/shell/app-shell";
import { ConnectReposButton } from "@/components/shell/connect-sheet";
import { Card } from "@/components/ui/card";
import {
  AttentionChart,
  AttentionSparkline,
  SeverityDonut,
  ShareBar,
  type SharePart,
} from "@/components/ui/charts";
import { EmptyState, PageHeader, SectionHeader, WeekPill } from "@/components/ui/section-header";
import { Tag } from "@/components/ui/tag";
import { requireOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { membershipFlashQuery } from "@/lib/flash";
import { plural, shortDate, shortDateTime } from "@/lib/format";
import { loadHome, type HomeData, type HomeStream } from "@/lib/home-load";
import { shouldOnboard } from "@/lib/member-state";
import { loadStreamScope } from "@/lib/stream-scope";
import { cn } from "@/lib/utils";
import { isoWeekLabel } from "@/pipeline/bulletin";
import {
  ago,
  countdown,
  hasTrend,
  HEALTH_ORDER,
  streamColumns,
  type ActivityKind,
  type HealthBucket,
} from "@/pipeline/home";

export const metadata: Metadata = { title: "Home · Briff" };

/**
 * Home: the answer first (four tiles), then the 12-week trend, each stream's bulletin,
 * security / stack / repos side by side and the org's recent activity.
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
  const scope = await loadStreamScope(ctx.orgId);
  const data = await loadHome(ctx.orgId, scope, now);
  const scopeName = scope.current?.name ?? "all streams";

  const current = data.streams.filter((s) => s.latest?.current);
  const attention = current.reduce((n, s) => n + (s.latest?.counts.act ?? 0), 0);
  const security = current.some((s) => (s.latest?.counts.securityAct ?? 0) > 0);
  const anyBulletin = data.streams.some((s) => s.latest);

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
          data.repos.total === 0 ? (
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
          data.repos.total === 0
            ? "Connect a repo and Briff starts watching its packages and runtimes."
            : `Across ${plural(data.streams.length, "stream")}. Alerts and stack follow ${scopeName}, the stream picked in the top bar; repos and activity cover the whole organisation.`
        }
      />

      {data.repos.total === 0 ? (
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
        <div className="grid grid-cols-1 gap-8">
          <TopStrip data={data} now={now} scopeName={scopeName} />

          {anyBulletin ? (
            <section aria-labelledby="trend" className="rise [--i:2]">
              <SectionHeader
                id="trend"
                title="Attention over time"
                action={<MoreLink href="/bulletins">All bulletins</MoreLink>}
              />
              <Card className="p-[18px] max-[560px]:p-[15px]">
                {hasTrend(data.trend) ? (
                  <AttentionChart series={data.trend} />
                ) : (
                  <p className="text-fg-muted py-10 text-center text-[13.5px]">
                    The trend starts once there are two weeks of bulletins or alerts. Until then,
                    each stream&apos;s latest bulletin is below.
                  </p>
                )}
              </Card>
            </section>
          ) : (
            <FirstMonday data={data} now={now} />
          )}

          <Streams streams={data.streams} weeks={data.weeks} next={data.nextBulletin} />

          <section aria-labelledby="health" className="rise [--i:4]">
            <SectionHeader id="health" title="Security and stack" />
            <div className="grid auto-rows-fr gap-3 min-[980px]:grid-cols-3">
              <AlertsCard data={data} scopeName={scopeName} />
              <StackCard data={data} scopeName={scopeName} />
              <ReposCard data={data} now={now} />
            </div>
          </section>

          <Activity data={data} now={now} />
        </div>
      )}
    </AppShell>
  );
}

function MoreLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="text-brand inline-flex items-center gap-1 text-[13px] font-medium underline-offset-4 hover:underline"
    >
      {children}
      <ArrowRight aria-hidden className="size-3.5" />
    </Link>
  );
}

function StatTile({
  href,
  value,
  caption,
  detail,
  tone = "fg",
  index,
}: {
  href: string;
  value: ReactNode;
  caption: string;
  detail: ReactNode;
  tone?: "fg" | "sec" | "ok";
  index: number;
}) {
  return (
    <Link
      href={href}
      style={{ "--i": index } as CSSProperties}
      className="rise group bg-surface border-line hover:border-line-strong hover:shadow-lift ease-entrance rounded-tile flex h-full min-w-0 flex-col border p-4 transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5"
    >
      <span className="text-fg-muted text-[12.5px] font-medium">{caption}</span>
      <b
        className={cn(
          "type-stat mt-2 block truncate max-[560px]:text-[28px]",
          tone === "sec" ? "text-sec" : tone === "ok" ? "text-ok" : "text-fg"
        )}
      >
        {value}
      </b>
      <span className="text-fg-muted mt-auto block pt-2.5 text-[12.5px] leading-[1.4]">
        {detail}
      </span>
    </Link>
  );
}

function TopStrip({ data, now, scopeName }: { data: HomeData; now: Date; scopeName: string }) {
  const { alerts, repos } = data;
  const withRepos = data.streams.filter((s) => s.repoCount > 0);
  const delta =
    alerts.delta === 0 ? (
      "same as last week"
    ) : (
      <span
        className={cn(
          "inline-flex items-center gap-0.5",
          alerts.delta > 0 ? "text-sec" : "text-ok"
        )}
      >
        {alerts.delta > 0 ? (
          <ArrowUp aria-hidden className="size-3" />
        ) : (
          <ArrowDown aria-hidden className="size-3" />
        )}
        {Math.abs(alerts.delta)} vs last week
      </span>
    );
  return (
    <section
      aria-label="This week at a glance"
      className="grid auto-rows-fr grid-cols-2 gap-3 min-[980px]:grid-cols-4"
    >
      <StatTile
        index={1}
        href="/alerts"
        caption={`Open alerts · ${scopeName}`}
        value={alerts.total}
        tone={alerts.urgent > 0 ? "sec" : "fg"}
        detail={
          <>
            <span className="text-fg">{alerts.urgent} critical/high</span> ·{" "}
            {alerts.total - alerts.urgent} other
            <br />
            {delta}
          </>
        }
      />
      <StatTile
        index={2}
        href="/alerts"
        caption="Resolved this week"
        value={alerts.resolvedThisWeek}
        tone={alerts.resolvedThisWeek > 0 ? "ok" : "fg"}
        detail={
          alerts.resolvedThisWeek > 0
            ? "Alerts a later scan no longer has."
            : "A scan without the affected version resolves an alert."
        }
      />
      <StatTile
        index={3}
        href="/repos"
        caption="Repos scanned"
        value={repos.total}
        detail={
          repos.stale.length > 0 ? (
            <>
              <span className="text-upgrade font-medium">{repos.stale.length} stale</span>, no scan
              in 7 days
            </>
          ) : (
            "Every repo scanned in the last 7 days."
          )
        }
      />
      {withRepos.length > 0 ? (
        <StatTile
          index={4}
          href="/streams"
          caption="Next bulletin"
          value={shortDate(data.nextBulletin)}
          detail={
            <>
              <span className="text-fg">{countdown(now, data.nextBulletin)}</span> · 04:00 UTC
              <br />
              {withRepos.length === 1 ? withRepos[0].name : `${plural(withRepos.length, "stream")}`}
            </>
          }
        />
      ) : (
        <StatTile
          index={4}
          href={data.lastBulletin ? `/b/${data.lastBulletin.id}` : "/streams"}
          caption="Last bulletin"
          value={data.lastBulletin ? isoWeekLabel(data.lastBulletin.weekStart).slice(5) : "None"}
          detail="No stream has repos, so no bulletin is scheduled."
        />
      )}
    </section>
  );
}

function FirstMonday({ data, now }: { data: HomeData; now: Date }) {
  const withRepos = data.streams.filter((s) => s.repoCount > 0);
  return (
    <section aria-labelledby="first" className="rise [--i:2]">
      <SectionHeader id="first" title="Your first bulletin" />
      <Card className="grid gap-6 p-[18px] max-[560px]:p-[15px] min-[768px]:grid-cols-[1fr_1.4fr]">
        <div>
          <div className="text-fg-subtle [&_svg]:size-9">
            <CalendarClock strokeWidth={1.4} />
          </div>
          <p className="type-h3 mt-3">{shortDateTime(data.nextBulletin)}</p>
          <p className="text-fg-muted mt-1 text-[13.5px]">
            {countdown(now, data.nextBulletin)}, for{" "}
            {withRepos.length > 0
              ? withRepos.map((s) => s.name).join(", ")
              : "every stream with a repo"}
            .
          </p>
        </div>
        <ol className="grid gap-3 text-[13.5px]">
          {[
            [
              "Collect",
              "Every hour Briff reads release notes, changelogs and advisories for the packages and runtimes your repos use.",
            ],
            [
              "Sort",
              "On Monday 04:00 UTC each stream gets what changed for its repos: must act first, then good to know.",
            ],
            [
              "Deliver",
              "Each member gets one email per stream; the bulletin also opens here, with the commands to run.",
            ],
          ].map(([title, text], i) => (
            <li key={title} className="flex gap-3">
              <span className="bg-brand-soft text-brand grid size-6 shrink-0 place-items-center rounded-full font-mono text-[12px] font-semibold">
                {i + 1}
              </span>
              <span>
                <b className="font-medium">{title}.</b>{" "}
                <span className="text-fg-muted">{text}</span>
              </span>
            </li>
          ))}
        </ol>
      </Card>
    </section>
  );
}

const STREAM_COLS: Record<1 | 2 | 3, string> = {
  1: "",
  2: "min-[768px]:grid-cols-2",
  3: "min-[768px]:grid-cols-2 min-[1100px]:grid-cols-3",
};

function Streams({ streams, weeks, next }: { streams: HomeStream[]; weeks: Date[]; next: Date }) {
  const cols = streamColumns(streams.length);
  return (
    <section aria-labelledby="streams" className="rise [--i:3]">
      <SectionHeader
        id="streams"
        title="Streams"
        count={streams.length}
        action={<MoreLink href="/streams">Manage streams</MoreLink>}
      />
      <div className={cn("grid auto-rows-fr gap-3", STREAM_COLS[cols])}>
        {streams.map((s) =>
          cols === 1 ? (
            <WideStreamCard key={s.id} stream={s} weeks={weeks} next={next} />
          ) : (
            <StreamCard key={s.id} stream={s} weeks={weeks} next={next} />
          )
        )}
      </div>
    </section>
  );
}

function StreamHead({ stream }: { stream: HomeStream }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <h3 className="truncate text-[15px] font-semibold">{stream.name}</h3>
        <p className="text-fg-muted text-[12.5px]">{plural(stream.repoCount, "repo")}</p>
      </div>
      {stream.latest && <WeekPill>{isoWeekLabel(stream.latest.weekStart).slice(5)}</WeekPill>}
    </div>
  );
}

function StreamCounts({ stream }: { stream: HomeStream }) {
  const c = stream.latest?.counts;
  if (!c) return null;
  return (
    <div className="flex gap-6">
      <div>
        <b className={cn("type-stat block", c.securityAct > 0 ? "text-sec" : "text-fg")}>{c.act}</b>
        <span className="text-fg-muted mt-1 block text-[12px]">need your attention</span>
      </div>
      <div>
        <b className="type-stat text-fg block">{c.know}</b>
        <span className="text-fg-muted mt-1 block text-[12px]">good to know</span>
      </div>
    </div>
  );
}

function StreamEmpty({ stream }: { stream: HomeStream }) {
  return (
    <p className="text-fg-muted text-[13px]">
      {stream.repoCount === 0 ? (
        <>
          No repos in this stream yet, so no bulletin.{" "}
          <Link
            href={`/streams?stream=${encodeURIComponent(stream.id)}`}
            className="text-brand underline-offset-4 hover:underline"
          >
            Pick repos
          </Link>
        </>
      ) : (
        "No bulletin yet. The first one arrives Monday 04:00 UTC."
      )}
    </p>
  );
}

function StreamFoot({ stream, next }: { stream: HomeStream; next: Date }) {
  return (
    <div className="border-line mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t pt-3 text-[12.5px]">
      <span className="text-fg-muted">
        {stream.repoCount > 0 ? (
          <>
            Next <b className="text-fg font-medium">{shortDate(next)}</b> 04:00 UTC
          </>
        ) : (
          "Not scheduled"
        )}
      </span>
      {stream.latest && <MoreLink href={`/b/${stream.latest.id}`}>Open bulletin</MoreLink>}
    </div>
  );
}

function Sparkline({ stream, weeks }: { stream: HomeStream; weeks: Date[] }) {
  return (
    <div>
      <p className="text-fg-muted mb-1 text-[12px]">Needs your attention, last 12 weeks</p>
      <AttentionSparkline
        weeks={weeks}
        values={stream.series}
        label={`${stream.name}: items that needed your attention per week`}
      />
    </div>
  );
}

function StreamCard({ stream, weeks, next }: { stream: HomeStream; weeks: Date[]; next: Date }) {
  const headline = stream.latest?.top[0];
  return (
    <Card className="@container flex h-full min-w-0 flex-col gap-4 p-[18px] max-[560px]:p-[15px]">
      <StreamHead stream={stream} />
      {stream.latest ? (
        <>
          <p className="line-clamp-2 min-h-[2.7em] text-[14px] leading-[1.35] font-medium">
            {headline?.text ?? "Nothing new for this stream's repos."}
          </p>
          {!stream.latest.current && (
            <p className="text-fg-muted -mt-2 text-[12.5px]">
              No bulletin this week yet; this is the latest.
            </p>
          )}
          <div className="grid gap-4 @min-[480px]:grid-cols-[auto_1fr] @min-[480px]:items-end @min-[480px]:gap-8">
            <StreamCounts stream={stream} />
            <Sparkline stream={stream} weeks={weeks} />
          </div>
        </>
      ) : (
        <StreamEmpty stream={stream} />
      )}
      <StreamFoot stream={stream} next={next} />
    </Card>
  );
}

function WideStreamCard({
  stream,
  weeks,
  next,
}: {
  stream: HomeStream;
  weeks: Date[];
  next: Date;
}) {
  const latest = stream.latest;
  return (
    <Card className="flex min-w-0 flex-col gap-5 p-[18px] max-[560px]:p-[15px]">
      <StreamHead stream={stream} />
      {latest ? (
        <div className="grid gap-6 min-[980px]:grid-cols-[1.35fr_1fr]">
          <div className="min-w-0">
            <p className="text-fg-muted text-[12.5px]">
              {latest.emailSentAt
                ? `Sent ${shortDateTime(latest.emailSentAt)}`
                : `Week of ${shortDate(latest.weekStart)}`}
              {!latest.current && " · no bulletin this week yet; this is the latest"}
            </p>
            {latest.top.length > 0 ? (
              <ul className="mt-3 grid gap-3">
                {latest.top.map((item, i) => (
                  <li key={i} className="flex min-w-0 items-start gap-2.5">
                    <Tag
                      kind={item.security ? "security" : item.section === "act" ? "brand" : "read"}
                      className="mt-px shrink-0"
                    >
                      {item.security ? "Security" : item.section === "act" ? "Act" : "Know"}
                    </Tag>
                    <span
                      className={cn(
                        "min-w-0 leading-[1.35]",
                        i === 0 ? "type-h3 text-[19px]" : "text-[14px] font-medium"
                      )}
                    >
                      {item.text}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[14px]">Nothing new for this stream&apos;s repos.</p>
            )}
          </div>
          <div className="grid content-start gap-5">
            <StreamCounts stream={stream} />
            <Sparkline stream={stream} weeks={weeks} />
          </div>
        </div>
      ) : (
        <StreamEmpty stream={stream} />
      )}
      <StreamFoot stream={stream} next={next} />
    </Card>
  );
}

function HealthCard({
  title,
  href,
  linkLabel,
  children,
  footer,
}: {
  title: string;
  href: string;
  linkLabel: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <Card className="flex h-full min-w-0 flex-col p-[18px] max-[560px]:p-[15px]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        <MoreLink href={href}>{linkLabel}</MoreLink>
      </div>
      {children}
      <div className="text-fg-muted border-line mt-auto border-t pt-3 text-[12.5px]">{footer}</div>
    </Card>
  );
}

function AlertsCard({ data, scopeName }: { data: HomeData; scopeName: string }) {
  const { alerts } = data;
  return (
    <HealthCard
      title="Alerts by severity"
      href="/alerts"
      linkLabel="Open Alerts"
      footer={
        alerts.backlogOpen > 0
          ? `${plural(alerts.backlogOpen, "advisory", "advisories")} from the first-scan backlog.`
          : alerts.total === 0
            ? `No open advisory for ${scopeName}'s repos.`
            : `Open advisories for ${scopeName}'s repos.`
      }
    >
      <div className="pb-4">
        <SeverityDonut counts={alerts.severity} caption="open" />
      </div>
    </HealthCard>
  );
}

const HEALTH_PART: Record<HealthBucket, { label: string; color: string }> = {
  eol: { label: "end of life", color: "var(--sec)" },
  major: { label: "majors behind", color: "var(--upgrade)" },
  minor: { label: "minor behind", color: "var(--wait)" },
  current: { label: "up to date", color: "var(--ok)" },
};

function StackCard({ data, scopeName }: { data: HomeData; scopeName: string }) {
  const { stack } = data;
  const parts: SharePart[] = HEALTH_ORDER.map((b) => ({
    key: b,
    count: stack.health[b],
    ...HEALTH_PART[b],
  }));
  return (
    <HealthCard
      title="Stack health"
      href="/stack"
      linkLabel="Open Stack"
      footer={
        stack.eol.length > 0 ? (
          <>
            End of life:{" "}
            <span className="text-fg font-mono text-[12px]">
              {stack.eol.slice(0, 3).join(", ")}
            </span>
            {stack.eol.length > 3 && ` and ${stack.eol.length - 3} more`}
          </>
        ) : stack.repos === 0 ? (
          `No repo in ${scopeName} yet.`
        ) : (
          "Every runtime is on a supported line."
        )
      }
    >
      <div className="pb-4">
        <div className="mb-3 flex items-baseline gap-2">
          {stack.health.eol > 0 ? (
            <>
              <b className="type-stat text-sec">{stack.health.eol}</b>
              <span className="text-fg-muted text-[12.5px]">
                of {plural(stack.repos, "repo")} on an end-of-life runtime
              </span>
            </>
          ) : (
            <>
              <b className="type-stat">{stack.health.current}</b>
              <span className="text-fg-muted text-[12.5px]">
                of {plural(stack.repos, "repo")} up to date
              </span>
            </>
          )}
        </div>
        <ShareBar parts={parts} />
      </div>
    </HealthCard>
  );
}

function ReposCard({ data, now }: { data: HomeData; now: Date }) {
  const { repos } = data;
  const rows: { label: string; value: number; tone?: string; names?: string[] }[] = [
    { label: "scanned", value: repos.total },
    {
      label: "stale, no scan in 7 days",
      value: repos.stale.length,
      tone: repos.stale.length > 0 ? "text-upgrade" : undefined,
      names: repos.stale,
    },
    { label: "in no stream", value: repos.unlinked.length, names: repos.unlinked },
  ];
  return (
    <HealthCard
      title="Repos"
      href="/repos"
      linkLabel="Open Repos"
      footer={
        repos.lastScan ? (
          <>
            Last scan <b className="text-fg font-medium">{shortDateTime(repos.lastScan)}</b> ·{" "}
            {ago(now, repos.lastScan)}
          </>
        ) : (
          "No scan yet."
        )
      }
    >
      {repos.total === 0 ? (
        <div className="pb-4">
          <ConnectReposButton />
        </div>
      ) : (
        <ul className="grid gap-2.5 pb-4">
          {rows.map((r) => (
            <li key={r.label} className="flex min-w-0 items-baseline gap-2.5">
              <b
                className={cn(
                  "w-8 shrink-0 text-right text-[19px] font-semibold tabular-nums",
                  r.tone
                )}
              >
                {r.value}
              </b>
              <span className="min-w-0 text-[13px]">
                <span className="text-fg-muted">{r.label}</span>
                {r.names && r.names.length > 0 && (
                  <span className="text-fg block truncate font-mono text-[12px]">
                    {r.names.slice(0, 3).join(", ")}
                    {r.names.length > 3 && ` +${r.names.length - 3}`}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </HealthCard>
  );
}

const ACTIVITY_TAG: Record<
  ActivityKind,
  { kind: "ok" | "brand" | "read" | "wait"; label: string }
> = {
  alert_resolved: { kind: "ok", label: "Resolved" },
  bulletin_sent: { kind: "brand", label: "Bulletin" },
  repo_added: { kind: "read", label: "Repo" },
  scan: { kind: "wait", label: "Scan" },
  member: { kind: "read", label: "Member" },
};

function Activity({ data, now }: { data: HomeData; now: Date }) {
  return (
    <section aria-labelledby="activity" className="rise [--i:5]">
      <SectionHeader id="activity" title="Recent activity" />
      <Card>
        {data.activity.length === 0 ? (
          <p className="text-fg-muted p-[18px] text-[13px]">Nothing yet.</p>
        ) : (
          <ul className="divide-line divide-y">
            {data.activity.map((e) => (
              <li key={e.key}>
                <Link
                  href={e.href}
                  className="hover:bg-surface-2 flex min-h-11 items-center gap-3 px-[18px] py-2.5 transition-colors duration-150 first:rounded-t-[15px] max-[560px]:px-[15px]"
                >
                  <Tag kind={ACTIVITY_TAG[e.kind].kind} className="min-w-[92px] shrink-0">
                    {ACTIVITY_TAG[e.kind].label}
                  </Tag>
                  <span className="min-w-0 flex-1 text-[13.5px] min-[560px]:truncate">
                    {e.text}
                  </span>
                  <time
                    dateTime={e.at.toISOString()}
                    className="text-fg-muted shrink-0 text-[12.5px] tabular-nums"
                  >
                    {ago(now, e.at)}
                    <span className="max-[768px]:hidden"> · {shortDateTime(e.at)}</span>
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
