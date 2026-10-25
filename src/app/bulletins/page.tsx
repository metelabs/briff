import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/shell/app-shell";
import { ConnectReposButton } from "@/components/shell/connect-sheet";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FilterLinks } from "@/components/ui/filter-chips";
import { EmptyState, PageHeader, WeekPill } from "@/components/ui/section-header";
import { Tag } from "@/components/ui/tag";
import { isInstanceAdmin, requireOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isoWeekLabel, subjectTopics } from "@/pipeline/bulletin";
import { sectionOf } from "@/pipeline/bulletin-view";

export const metadata: Metadata = { title: "Bulletins · Briff" };

interface Counts {
  act: number;
  securityAct: number;
  know: number;
  rest: number;
}

const EMAIL_STATUS: Record<string, string> = {
  pending: "Email pending",
  failed: "Email failed",
  skipped: "Not emailed",
};

export default async function BulletinsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireOrgContext();
  const query = await searchParams;
  const db = withOrg(getDb(), ctx.orgId);
  const [streams, admin, perStream] = await Promise.all([
    db.bulletinStream.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, slug: true },
    }),
    isInstanceAdmin(ctx.userId),
    db.bulletin.groupBy({ by: ["streamId"], where: { preview: false }, _count: { _all: true } }),
  ]);
  const active = streams.find((s) => s.slug === query.stream) ?? null;
  const select = {
    id: true,
    weekStart: true,
    subject: true,
    summary: true,
    emailStatus: true,
    emailSentAt: true,
    streamId: true,
    minorCount: true,
  } as const;
  const streamFilter = active ? { streamId: active.id } : {};
  // Previews are listed on /admin only.
  const bulletins = await db.bulletin.findMany({
    where: { ...streamFilter, preview: false },
    orderBy: [{ weekStart: "desc" }, { createdAt: "asc" }],
    take: 104,
    select,
  });
  const ids = bulletins.map((b) => b.id);
  const sectionRows =
    ids.length > 0
      ? await db.bulletinItem.groupBy({
          by: ["bulletinId", "section", "bucket"],
          where: { bulletinId: { in: ids } },
          _count: { _all: true },
        })
      : [];
  const counts = new Map<string, Counts>();
  for (const row of sectionRows) {
    const c = counts.get(row.bulletinId) ?? { act: 0, securityAct: 0, know: 0, rest: 0 };
    const section = sectionOf(row.section, row.bucket);
    c[section] += row._count._all;
    if (section === "act" && row.bucket === "security") c.securityAct += row._count._all;
    counts.set(row.bulletinId, c);
  }
  const streamName = new Map(streams.map((s) => [s.id, s.name]));
  const totalPerStream = new Map(perStream.map((p) => [p.streamId, p._count._all]));
  const total = perStream.reduce((n, p) => n + p._count._all, 0);
  const filters = [
    { href: "/bulletins", label: "All streams", count: total, current: active === null },
    ...streams.map((s) => ({
      href: `/bulletins?stream=${encodeURIComponent(s.slug)}`,
      label: s.name,
      count: totalPerStream.get(s.id) ?? 0,
      current: active?.id === s.id,
    })),
  ];

  return (
    <AppShell ctx={ctx} active="/bulletins">
      <PageHeader
        title="Bulletins"
        sub="Every Monday, one bulletin per stream. Open one to see what needs you."
      />
      {streams.length > 1 && (
        <div className="rise mb-3.5 [--i:1]">
          <FilterLinks label="Streams" options={filters} />
        </div>
      )}
      {bulletins.length === 0 ? (
        <Card className="rise [--i:2]">
          <EmptyState
            icon={<Inbox strokeWidth={1.4} />}
            title="No bulletin yet"
            action={
              admin ? (
                <Link href="/admin" className={buttonVariants({ variant: "primary" })}>
                  Open Admin
                </Link>
              ) : (
                <ConnectReposButton />
              )
            }
          >
            Bulletins arrive on Monday 04:00 UTC, one per stream with repos
            {admin ? "; Admin can generate one now." : "."}
          </EmptyState>
        </Card>
      ) : (
        <Card className="rise overflow-hidden [--i:2]">
          <ul>
            {bulletins.map((b, i) => (
              <BulletinRow
                key={b.id}
                bulletin={b}
                stream={(b.streamId && streamName.get(b.streamId)) || null}
                counts={counts.get(b.id)}
                latest={i === 0 && active === null}
              />
            ))}
          </ul>
        </Card>
      )}
    </AppShell>
  );
}

function BulletinRow({
  bulletin: b,
  stream,
  counts,
  latest,
}: {
  bulletin: {
    id: string;
    weekStart: Date;
    subject: string;
    summary: string;
    emailStatus: string;
    emailSentAt: Date | null;
    minorCount: number;
  };
  stream: string | null;
  counts: Counts | undefined;
  latest: boolean;
}) {
  const c = counts ?? { act: 0, securityAct: 0, know: 0, rest: 0 };
  const sent =
    b.emailStatus === "sent" && b.emailSentAt
      ? `Emailed ${shortDate(b.emailSentAt)}`
      : (EMAIL_STATUS[b.emailStatus] ?? "");
  return (
    <li className="border-line border-t first:border-t-0">
      <Link
        href={`/b/${b.id}`}
        className="hover:bg-surface-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 px-[18px] py-3.5 transition-colors duration-150 md:grid-cols-[auto_minmax(0,1fr)_auto]"
      >
        <span className="self-start">
          <WeekPill>{isoWeekLabel(b.weekStart).slice(5)}</WeekPill>
        </span>
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold">{stream ?? "No stream"}</span>
            <span className="text-fg-muted text-[12.5px]">{sent}</span>
            {latest && <Tag kind="brand">Latest</Tag>}
          </div>
          <p className="text-[15px] leading-[1.4] font-medium">
            {b.summary || subjectTopics(b.subject, stream) || "Bulletin"}
          </p>
        </div>
        <div className="text-fg-muted col-start-2 flex items-baseline gap-3.5 text-[12.5px] whitespace-nowrap md:col-start-auto">
          <span>
            <b
              className={cn(
                "font-display mr-[3px] text-[20px] font-semibold tracking-[-0.02em] tabular-nums",
                c.securityAct > 0 ? "text-sec" : "text-fg"
              )}
            >
              {c.act}
            </b>
            attention
          </span>
          <span>
            <b className="font-display text-fg mr-[3px] text-[20px] font-semibold tracking-[-0.02em] tabular-nums">
              {c.know}
            </b>
            to know
          </span>
          <span>
            <b className="font-display text-fg mr-[3px] text-[20px] font-semibold tracking-[-0.02em] tabular-nums">
              {c.rest + b.minorCount}
            </b>
            folded
          </span>
        </div>
      </Link>
    </li>
  );
}
