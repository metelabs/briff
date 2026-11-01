import type { Metadata } from "next";

import { OG_IMAGE } from "@/components/landing/links";
import { PublicFooter, PublicHeader } from "@/components/landing/public-chrome";
import { PageContainer } from "@/components/shell/page-container";
import { Card } from "@/components/ui/card";
import { Tag, type TagKind } from "@/components/ui/tag";
import { isCloud } from "@/lib/env";
import { INCIDENTS } from "@/lib/ops/incidents";
import { fetchHealth } from "@/lib/ops/status-fetch";
import {
  agoLabel,
  durationLabel,
  utcLabel,
  statusView,
  type ComponentState,
  type JobState,
  type Overall,
} from "@/lib/ops/status-view";
import { publicSiteUrl } from "@/lib/public-site";
import { cn } from "@/lib/utils";

import packageJson from "../../../package.json";
import { AutoRefresh } from "./_client";

// Public status page: the full /api/health answer, read on every request from this same
// server (no database import here: src/test/public-routes.test.ts), refreshed every minute.
export const dynamic = "force-dynamic";

const REFRESH_SECONDS = 60;

export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(publicSiteUrl()),
    title: "Status · Briff",
    description: "Whether Briff's web app, database and scheduled jobs are running on time.",
    alternates: { canonical: "/status" },
    openGraph: { title: "Status · Briff", url: "/status", siteName: "Briff", images: [OG_IMAGE] },
    robots: { index: true, follow: true },
  };
}

const COMPONENT_TAG: Record<ComponentState, [TagKind, string]> = {
  operational: ["ok", "Operational"],
  degraded: ["upgrade", "Degraded"],
  down: ["upgrade", "Down"],
  unknown: ["wait", "Unknown"],
};

const JOB_TAG: Record<JobState, [TagKind, string]> = {
  "on-schedule": ["ok", "On schedule"],
  late: ["upgrade", "Late"],
  "not-run-yet": ["wait", "Not run yet"],
};

// Coral is for security only (DESIGN.md §3): a degraded or down service is ochre.
const BANNER: Record<Overall, string> = {
  operational: "bg-ok-soft border-ok/30 text-ok",
  degraded: "bg-upgrade-soft border-upgrade/30 text-upgrade",
  down: "bg-upgrade-soft border-upgrade/30 text-upgrade",
};

export default async function StatusPage() {
  const cloud = isCloud();
  const checkedAt = new Date();
  const view = statusView(await fetchHealth());

  return (
    <div className="flex min-h-svh flex-col">
      <AutoRefresh seconds={REFRESH_SECONDS} />
      <PublicHeader pricing={cloud} />
      <PageContainer as="main" className="pb-16">
        <div className="mx-auto max-w-[760px] pt-8 md:pt-12">
          <header className="rise">
            <p className="text-fg-muted text-[13px]">Status</p>
            <h1 className="type-page mt-2 text-balance">Is Briff running?</h1>
          </header>

          <section
            aria-live="polite"
            className={cn("rise rounded-card mt-6 border px-5 py-4 [--i:1]", BANNER[view.overall])}
          >
            <p className="flex items-center gap-2.5">
              <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-current" />
              <span className="type-h2">{view.headline}</span>
            </p>
            <p className="text-fg-muted mt-1.5 pl-5 text-[13px] tabular-nums">
              Last checked <time dateTime={checkedAt.toISOString()}>{utcLabel(checkedAt)}</time> ·
              refreshes every minute
            </p>
          </section>

          <section aria-labelledby="components" className="rise mt-10 [--i:2]">
            <h2 id="components" className="type-h2 mb-3">
              Components
            </h2>
            <Card className="overflow-hidden">
              {view.components.map((c) => {
                const [kind, label] = COMPONENT_TAG[c.state];
                return (
                  <div
                    key={c.name}
                    className="border-line flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t px-[15px] py-3.5 first:border-t-0 min-[560px]:px-[18px]"
                  >
                    <div className="min-w-0">
                      <p className="text-[15px] font-medium">{c.name}</p>
                      <p className="text-fg-muted text-[13px]">{c.detail}</p>
                    </div>
                    <Tag kind={kind}>{label}</Tag>
                  </div>
                );
              })}
            </Card>
          </section>

          {view.jobs.length > 0 && (
            <section aria-labelledby="jobs" className="rise mt-10 [--i:3]">
              <h2 id="jobs" className="type-h2 mb-1">
                Worker jobs
              </h2>
              <p className="text-fg-muted mb-3 text-[13px]">
                Each scheduled job and its last success. A job is late once it missed its interval
                plus a grace period.
              </p>
              <Card className="overflow-hidden">
                {view.jobs.map((j) => {
                  const [kind, label] = JOB_TAG[j.state];
                  return (
                    <div
                      key={j.type}
                      className="border-line grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-t px-[15px] py-3 first:border-t-0 min-[560px]:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_104px] min-[560px]:px-[18px]"
                    >
                      <div className="min-w-0 min-[560px]:col-start-1">
                        <p className="text-[14px] font-medium">{j.label}</p>
                        <p className="text-fg-muted text-[12.5px]">{j.cadence}</p>
                      </div>
                      <p className="text-fg-muted col-span-2 row-start-2 text-[12.5px] tabular-nums min-[560px]:col-span-1 min-[560px]:col-start-2 min-[560px]:row-start-1">
                        {j.lastSuccessAt ? (
                          <>
                            Last success {agoLabel(j.lastSuccessAt, checkedAt)}
                            <span className="text-fg-subtle"> · </span>
                            <time dateTime={j.lastSuccessAt.toISOString()} className="font-mono">
                              {utcLabel(j.lastSuccessAt)}
                            </time>
                          </>
                        ) : (
                          "No success recorded"
                        )}
                      </p>
                      <Tag
                        kind={kind}
                        className="col-start-2 row-start-1 justify-self-end min-[560px]:col-start-3"
                      >
                        {label}
                      </Tag>
                    </div>
                  );
                })}
              </Card>
              {view.queue && (
                <p className="text-fg-muted mt-3 text-[13px]">
                  Queue lag:{" "}
                  <span
                    className={cn(
                      "font-medium tabular-nums",
                      view.queue.late ? "text-upgrade" : "text-fg"
                    )}
                  >
                    {view.queue.oldestPendingSeconds === null
                      ? "no job waiting"
                      : `oldest due job waiting ${durationLabel(view.queue.oldestPendingSeconds)}`}
                  </span>{" "}
                  (limit {durationLabel(view.queue.limitSeconds)})
                </p>
              )}
            </section>
          )}

          <section aria-labelledby="incidents" className="rise mt-10 [--i:4]">
            <h2 id="incidents" className="type-h2 mb-3">
              Incidents
            </h2>
            {INCIDENTS.length === 0 ? (
              <Card className="text-fg-muted px-[18px] py-4 text-[14px]">
                No incidents recorded.
              </Card>
            ) : (
              <Card className="overflow-hidden">
                {INCIDENTS.map((i) => (
                  <article
                    key={`${i.date}-${i.title}`}
                    className="border-line border-t px-[18px] py-3.5 first:border-t-0"
                  >
                    <p className="text-fg-muted font-mono text-[12.5px]">{i.date}</p>
                    <h3 className="mt-1 text-[15px] font-medium">{i.title}</h3>
                    <p className="text-fg-muted mt-1 text-[13.5px]">{i.summary}</p>
                  </article>
                ))}
              </Card>
            )}
          </section>

          <p className="text-fg-muted mt-10 text-[12.5px]">
            Version <span className="font-mono tabular-nums">{packageJson.version}</span> ·
            machine-readable:{" "}
            <a href="/api/health" className="text-brand underline-offset-4 hover:underline">
              /api/health
            </a>
          </p>
        </div>
      </PageContainer>
      <PublicFooter pricing={cloud} />
    </div>
  );
}
