import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/shell/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/section-header";
import { TruncatedText } from "@/components/ui/tooltip";
import { requireAdminContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { envWarnings } from "@/lib/env";
import { JOB_TYPES } from "@/lib/jobs/types";
import { isoWeekLabel } from "@/pipeline/bulletin";
import { PREVIEW_MODELS } from "@/pipeline/preview-payload";

import {
  DeletePreviewButton,
  JobButton,
  PreviewForm,
  TestEmailButton,
  LimitsForm,
} from "./_client";

export const metadata: Metadata = { title: "Admin · Briff" };

interface LastRunRow {
  jobType: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  counts: unknown;
  tokens: unknown;
}

function when(date: Date | null): string {
  return date ? date.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—";
}

function compact(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  return Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => `${k} ${String(v)}`)
    .join(" · ");
}

export default async function AdminPage() {
  const ctx = await requireAdminContext();
  const db = getDb();
  const scoped = withOrg(db, ctx.orgId);
  const organisations = await db.org.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, repoLimit: true, streamLimit: true },
  });
  const [lastRuns, errors, queued, streams, previews] = await Promise.all([
    db.$queryRaw<LastRunRow[]>`
      SELECT DISTINCT ON ("jobType") "jobType", "status"::text AS "status", "startedAt", "finishedAt", "counts", "tokens"
      FROM "run" ORDER BY "jobType", "startedAt" DESC`,
    db.run.findMany({
      where: { status: "failed" },
      orderBy: { startedAt: "desc" },
      take: 8,
      select: { id: true, jobType: true, startedAt: true, error: true },
    }),
    db.job.findMany({
      where: { status: { in: ["pending", "running"] } },
      orderBy: { runAfter: "asc" },
      select: { id: true, type: true, status: true, runAfter: true, attempts: true },
    }),
    scoped.bulletinStream.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, _count: { select: { repos: true } } },
    }),
    scoped.bulletin.findMany({
      where: { preview: true },
      orderBy: [{ weekStart: "desc" }, { updatedAt: "desc" }],
      take: 20,
      select: {
        id: true,
        weekStart: true,
        previewKey: true,
        model: true,
        updatedAt: true,
        stream: { select: { name: true } },
        _count: { select: { items: true } },
      },
    }),
  ]);
  const previewStreams = streams.filter((s) => s._count.repos > 0);
  const byType = new Map(lastRuns.map((r) => [r.jobType, r]));
  const warnings = envWarnings();

  return (
    <AppShell ctx={ctx} active="/admin">
      <PageHeader
        eyebrow="This instance"
        title="Admin"
        sub="Run jobs by hand, preview a synthesis, and see what the worker did last."
      />
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Organisation limits</CardTitle>
          <CardDescription>
            Raise repository and stream capacity for an organisation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {organisations.map((org) => (
            <LimitsForm key={org.id} org={org} />
          ))}
        </CardContent>
      </Card>
      <div className="grid items-start gap-3 min-[980px]:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Run now</CardTitle>
            <CardDescription>
              For the first bulletin: collect → (triage runs by itself) → security scan → generate
              bulletin.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <JobButton type="collect-sources" label="Run collect now" />
            <JobButton type="security-scan" label="Run security scan now" />
            <JobButton type="triage-items" label="Run triage now" />
            <JobButton type="weekly-bulletin" label="Generate bulletin now" />
            <TestEmailButton />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Preview synthesis</CardTitle>
            <CardDescription>
              Runs this week&apos;s selection and synthesis for one stream with the chosen model and
              stores it as a preview: never emailed, and the week&apos;s bulletin is left alone.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {previewStreams.length === 0 ? (
              <p className="text-fg-muted text-[13.5px]">No stream has repos yet.</p>
            ) : (
              <PreviewForm
                streams={previewStreams.map((s) => ({ id: s.id, name: s.name }))}
                models={PREVIEW_MODELS}
              />
            )}
            {previews.length > 0 && (
              <ul className="divide-y border-t text-[13.5px]">
                {previews.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                    <Link href={`/b/${p.id}`} className="flex min-w-0 flex-col hover:underline">
                      <TruncatedText className="font-medium" focusable={false}>
                        {p.stream?.name ?? "No stream"} · {p.previewKey}
                      </TruncatedText>
                      <span className="text-fg-muted text-[12.5px]">
                        {isoWeekLabel(p.weekStart)} · {p._count.items} items · {when(p.updatedAt)}
                      </span>
                    </Link>
                    <DeletePreviewButton
                      id={p.id}
                      label={`Preview of ${p.stream?.name ?? "no stream"} with ${p.previewKey}`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

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
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Last run per job</CardTitle>
              <Link
                href="/admin/runs"
                className="text-brand text-[13px] font-medium hover:underline"
              >
                All runs →
              </Link>
            </div>
            {queued.length > 0 && (
              <CardDescription>
                Queued:{" "}
                {queued.map((j) => `${j.type} (${j.status}, attempt ${j.attempts})`).join(", ")}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-[13.5px]">
              {JOB_TYPES.map((type) => {
                const run = byType.get(type);
                const tokens = compact(run?.tokens);
                return (
                  <li key={type} className="flex flex-col gap-0.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[13px] font-medium">{type}</span>
                      <span
                        className={
                          run?.status === "failed"
                            ? "text-upgrade text-[12.5px]"
                            : "text-fg-muted text-[12.5px]"
                        }
                      >
                        {run
                          ? `${run.status} · ${when(run.finishedAt ?? run.startedAt)}`
                          : "never ran"}
                      </span>
                    </div>
                    {run && (
                      <span className="text-fg-muted text-[12.5px] break-words">
                        {compact(run.counts)}
                      </span>
                    )}
                    {tokens && (
                      <span className="text-fg-muted text-[12.5px] break-words">
                        tokens: {tokens}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent errors</CardTitle>
          </CardHeader>
          <CardContent>
            {errors.length === 0 ? (
              <p className="text-fg-muted text-[13.5px]">None.</p>
            ) : (
              <ul className="flex flex-col gap-3 text-[13.5px]">
                {errors.map((e) => (
                  <li key={e.id} className="flex flex-col gap-1">
                    <span className="font-medium">
                      {e.jobType} ·{" "}
                      <span className="text-fg-muted font-normal">{when(e.startedAt)}</span>
                    </span>
                    <pre className="bg-surface-2 overflow-x-auto rounded-[10px] p-3 font-mono text-[12px] whitespace-pre-wrap">
                      {(e.error ?? "").split("\n").slice(0, 4).join("\n")}
                    </pre>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
