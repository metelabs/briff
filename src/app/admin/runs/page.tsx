import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/shell/app-shell";
import { Card } from "@/components/ui/card";
import { CollapsedList } from "@/components/ui/collapsed-list";
import { CountBadge, PageHeader } from "@/components/ui/section-header";
import { Tag, type TagKind } from "@/components/ui/tag";
import { requireAdminContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { utcStamp } from "@/lib/email/ops-email";
import { JOB_TYPES } from "@/lib/jobs/types";
import type { Freshness } from "@/lib/ops/freshness";
import { loadJobHealth } from "@/lib/ops/health";
import { countsLabel, durationLabel, groupRuns, type RunRow } from "@/lib/ops/runs";

import { JobButton } from "../_client";
import { RUNNABLE_JOB_TYPES } from "../job-types";

export const metadata: Metadata = { title: "Runs · Admin · Briff" };

const WINDOW_DAYS = 7;

const STATUS_TAG: Record<string, { kind: TagKind; label: string }> = {
  succeeded: { kind: "ok", label: "Succeeded" },
  failed: { kind: "upgrade", label: "Failed" },
  running: { kind: "wait", label: "Running" },
};

const FRESHNESS_TAG: Record<Freshness, { kind: TagKind; label: string }> = {
  ok: { kind: "ok", label: "On schedule" },
  stale: { kind: "upgrade", label: "Overdue" },
  never: { kind: "wait", label: "Not run yet" },
};

function firstLine(text: string, max = 140): string {
  const line = text.split("\n")[0] ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function RunLine({ run }: { run: RunRow }) {
  const status = STATUS_TAG[run.status] ?? { kind: "wait" as const, label: run.status };
  const duration = durationLabel(run);
  const counts = countsLabel(run.counts);
  return (
    <div className="flex flex-col gap-1 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Tag kind={status.kind}>{status.label}</Tag>
        <span className="text-[13.5px] tabular-nums">{utcStamp(run.startedAt)}</span>
        {duration && <span className="text-fg-muted text-[12.5px] tabular-nums">{duration}</span>}
      </div>
      {counts && <p className="text-fg-muted text-[12.5px] break-words">{counts}</p>}
      {run.error && (
        <details className="group/err">
          <summary className="text-fg-muted cursor-pointer font-mono text-[12px] break-words marker:content-none">
            <span className="text-brand mr-1.5 font-sans font-medium group-open/err:hidden">
              Show error
            </span>
            <span className="text-brand mr-1.5 hidden font-sans font-medium group-open/err:inline">
              Hide error
            </span>
            {firstLine(run.error)}
          </summary>
          <pre className="bg-surface-2 border-line mt-2 max-h-80 overflow-auto rounded-[12px] border p-3 font-mono text-[12px] leading-[1.5] whitespace-pre-wrap">
            {run.error}
          </pre>
        </details>
      )}
    </div>
  );
}

export default async function AdminRunsPage() {
  const ctx = await requireAdminContext();
  const db = getDb();
  const now = new Date();
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const [rows, health] = await Promise.all([
    db.run.findMany({
      where: { startedAt: { gte: since } },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        jobType: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        counts: true,
        error: true,
      },
    }),
    loadJobHealth(db, now),
  ]);
  const groups = groupRuns(rows, JOB_TYPES);
  const failed = rows.filter((r) => r.status === "failed").length;
  const runnable: readonly string[] = RUNNABLE_JOB_TYPES;
  const knownTypes: readonly string[] = JOB_TYPES;

  return (
    <AppShell ctx={ctx} active="/admin">
      <PageHeader
        eyebrow={
          <Link href="/admin" className="text-brand hover:underline">
            Admin
          </Link>
        }
        title="Runs"
        sub={
          rows.length === 0
            ? `No runs in the last ${WINDOW_DAYS} days. Is the worker running?`
            : `${rows.length} runs in the last ${WINDOW_DAYS} days, ${failed} failed${
                health.stale.length > 0 ? `; overdue: ${health.stale.join(", ")}` : ""
              }.`
        }
      />
      <div className="grid gap-3">
        {groups.map((group) => {
          const fresh = health.freshness[group.jobType];
          const freshTag = fresh ? FRESHNESS_TAG[fresh.status] : null;
          return (
            <Card key={group.jobType} className="p-[18px] max-[560px]:p-[15px]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-mono text-[15px] font-medium">{group.jobType}</h2>
                    <CountBadge>{group.runs.length}</CountBadge>
                    {freshTag ? (
                      <Tag kind={freshTag.kind}>{freshTag.label}</Tag>
                    ) : (
                      <Tag kind="wait">
                        {knownTypes.includes(group.jobType) ? "On demand" : "Unknown type"}
                      </Tag>
                    )}
                  </div>
                  <p className="text-fg-muted text-[12.5px] tabular-nums">
                    {group.succeeded} succeeded · {group.failed} failed
                    {fresh?.lastSuccessAt ? ` · last success ${utcStamp(fresh.lastSuccessAt)}` : ""}
                    {fresh?.status === "ok" && fresh.dueBy
                      ? ` · overdue after ${utcStamp(fresh.dueBy)}`
                      : ""}
                  </p>
                </div>
                {runnable.includes(group.jobType) && (
                  <div className="w-auto">
                    <JobButton type={group.jobType} label="Run now" />
                  </div>
                )}
              </div>
              {group.runs.length === 0 ? (
                <p className="text-fg-muted mt-3 text-[13.5px]">
                  No runs in the last {WINDOW_DAYS} days.
                </p>
              ) : (
                <CollapsedList
                  className="mt-2"
                  listClassName="divide-line divide-y"
                  limit={5}
                  moreLabel={(n) => `Show ${n} older runs`}
                  rows={group.runs.map((run) => ({ key: run.id, node: <RunLine run={run} /> }))}
                />
              )}
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}
