import type { Metadata } from "next";

import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/section-header";
import { requireOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { orgRecipients } from "@/lib/email/recipients";
import { loadStreamScope } from "@/lib/stream-scope";
import { isoWeekLabel } from "@/pipeline/bulletin";
import { sectionOf } from "@/pipeline/bulletin-view";

import { NewStreamButton, StreamsEditor, type StreamSummary } from "./_client";

export const metadata: Metadata = { title: "Streams · Briff" };

export default async function StreamsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireOrgContext();
  const query = await searchParams;
  const db = getDb();
  const scoped = withOrg(db, ctx.orgId);
  const [streams, repos, recipients, scope] = await Promise.all([
    scoped.bulletinStream.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        repos: { select: { repoId: true } },
        bulletins: {
          where: { preview: false },
          orderBy: { weekStart: "desc" },
          take: 1,
          select: { id: true, weekStart: true },
        },
      },
    }),
    scoped.repo.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    orgRecipients(db, ctx.orgId),
    loadStreamScope(ctx.orgId),
  ]);
  const latestIds = streams.flatMap((s) => s.bulletins.map((b) => b.id));
  const sections =
    latestIds.length > 0
      ? await scoped.bulletinItem.groupBy({
          by: ["bulletinId", "section", "bucket"],
          where: { bulletinId: { in: latestIds } },
          _count: { _all: true },
        })
      : [];
  const attention = new Map<string, number>();
  for (const row of sections) {
    if (sectionOf(row.section, row.bucket) !== "act") continue;
    attention.set(row.bulletinId, (attention.get(row.bulletinId) ?? 0) + row._count._all);
  }
  const to = [...new Set(recipients.map((r) => r.to))].join(", ");
  const summaries: StreamSummary[] = streams.map((s) => {
    const last = s.bulletins[0];
    const n = last ? (attention.get(last.id) ?? 0) : 0;
    return {
      id: s.id,
      name: s.name,
      memberIds: s.repos.map((r) => r.repoId),
      last: last
        ? `${isoWeekLabel(last.weekStart).slice(5)} · ${n === 0 ? "nothing to act on" : `${n} attention`}`
        : null,
    };
  });
  const requested = typeof query.stream === "string" ? query.stream : null;
  const initial =
    summaries.find((s) => s.id === requested)?.id ?? scope.current?.id ?? summaries[0]?.id ?? null;

  return (
    <AppShell ctx={ctx} active="/streams">
      <PageHeader
        title="Streams"
        sub="A stream is a named set of repos with its own weekly bulletin. A repo can be in more than one stream; security alerts cover every repo in any stream."
        actions={<NewStreamButton />}
      />
      <StreamsEditor streams={summaries} repos={repos} recipients={to} initialId={initial} />
    </AppShell>
  );
}
