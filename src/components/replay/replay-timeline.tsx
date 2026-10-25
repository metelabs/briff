import type { CSSProperties } from "react";

import { Card } from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import { caps } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  dayLabel,
  delayLabel,
  emailKindLabel,
  REPLAY_METHOD,
  replayCommand,
  sampleRepos,
  timeLabel,
  WEEKLY_TIMING,
  worldTimeLabel,
} from "@/replay/render";
import type { ReplayEmail, ReplayEntry, ReplayResult, WorldEvent } from "@/replay/types";

import { MailFrame } from "./mail-frame";

// A replay as the app renders it: the same result and copy as docs/replay (src/replay/render.ts),
// in the Triage system. Left: what happened, with sources. Right: what Briff sent, each email
// in its own frame, with the send time and the delay from the fact that triggered it.

function WorldCard({ event }: { event: WorldEvent }) {
  return (
    <Card className="min-w-0 p-[15px] min-[560px]:p-[18px]">
      <p className="text-fg-muted mb-1.5 flex flex-wrap items-center gap-2 text-[12.5px]">
        <Tag kind="wait" className="min-[980px]:hidden">
          What happened
        </Tag>
        <time dateTime={event.at.toISOString()} className="text-fg font-mono tabular-nums">
          {worldTimeLabel(event)}
        </time>
      </p>
      <h3 className="text-[15px] leading-[1.35] font-medium text-balance">{event.title}</h3>
      {event.detail && <p className="text-fg-muted mt-1.5 text-[13.5px]">{event.detail}</p>}
      <p className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px]">
        {event.sources.map((s) => (
          <a
            key={s.url}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="text-brand underline-offset-4 hover:underline"
          >
            {s.label}
          </a>
        ))}
      </p>
    </Card>
  );
}

function EmailCard({ email }: { email: ReplayEmail }) {
  const urgent = email.kind === "urgent";
  return (
    <article
      className={cn(
        "bg-surface border-line rounded-card min-w-0 border p-[15px] min-[560px]:p-[18px]",
        urgent && "border-t-sec border-t-[3px]"
      )}
    >
      <p className="text-fg-muted mb-1.5 flex flex-wrap items-center gap-2 text-[12.5px]">
        <Tag kind={urgent ? "security" : "brand"} className="min-[980px]:hidden">
          What Briff sent
        </Tag>
        <time dateTime={email.at.toISOString()} className="text-fg font-mono tabular-nums">
          {timeLabel(email.at)}
        </time>
      </p>
      <p className="mb-3 text-[13.5px]">
        {emailKindLabel(email)} ·{" "}
        {email.trigger && email.delayMinutes !== null ? (
          <>
            <b className={cn("font-semibold tabular-nums", urgent && "text-sec")}>
              {delayLabel(email.delayMinutes)}
            </b>{" "}
            after “{email.trigger.title}” appeared
          </>
        ) : (
          WEEKLY_TIMING
        )}
      </p>
      <MailFrame subject={email.subject} html={email.html} />
    </article>
  );
}

function Row({ entry }: { entry: ReplayEntry }) {
  if (entry.worldEvent) {
    return (
      <li className="grid gap-6 min-[980px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <WorldCard event={entry.worldEvent} />
      </li>
    );
  }
  if (entry.briffEmail) {
    return (
      <li className="grid gap-6 min-[980px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="min-w-0 min-[980px]:col-start-2">
          <EmailCard email={entry.briffEmail} />
        </div>
      </li>
    );
  }
  return null;
}

function byDay(entries: readonly ReplayEntry[]): ReplayEntry[][] {
  const days = new Map<string, ReplayEntry[]>();
  for (const e of entries) {
    const key = e.at.toISOString().slice(0, 10);
    days.set(key, [...(days.get(key) ?? []), e]);
  }
  return [...days.values()];
}

export function SampleRepos({ result }: { result: ReplayResult }) {
  const repos = sampleRepos(result);
  return (
    <details className="group/repos bg-surface border-line rounded-card max-w-[760px] border px-[18px] py-3">
      <summary className="cursor-pointer text-[14px] font-medium marker:content-none">
        <span className="text-fg-muted mr-1.5 inline-block transition-transform duration-200 group-open/repos:rotate-90">
          ›
        </span>
        Sample repos ({repos.length})
      </summary>
      <ul className="mt-3 grid gap-3">
        {repos.map((r) => (
          <li key={r.name} className="grid gap-1">
            <b className="font-mono text-[13px] font-medium">{r.name}</b>
            <pre className="bg-surface-2 rounded-inset px-3 py-2 text-[12.5px] leading-[1.45] break-words whitespace-pre-wrap">
              {r.files}
            </pre>
            <span className="text-fg-muted text-[12.5px]">Scanned: {r.runs}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function ReplayTimeline({ result }: { result: ReplayResult }) {
  return (
    <div>
      <div
        aria-hidden
        className="bg-bg/85 border-line sticky top-0 z-10 hidden grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-6 border-b py-2.5 backdrop-blur-md min-[980px]:grid"
      >
        <span className="type-label text-fg-muted">{caps("What happened")}</span>
        <span className="type-label text-sec">{caps("What Briff sent")}</span>
      </div>
      {byDay(result.entries).map((list, i) => (
        <section
          key={list[0].at.toISOString()}
          className="rise"
          style={{ "--i": Math.min(i + 2, 10) } as CSSProperties}
        >
          <h2 className="text-fg-muted border-line mt-7 mb-3 border-b border-dashed pb-1.5 text-[14px] font-semibold">
            {dayLabel(list[0].at)}
          </h2>
          <ol className="grid gap-3.5">
            {list.map((e, j) => (
              <Row key={j} entry={e} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

export function ReplayMethod({ id }: { id: string }) {
  return (
    <section className="border-line text-fg-muted mt-12 max-w-[760px] border-t pt-5 text-[13.5px]">
      <p>{REPLAY_METHOD}</p>
      <p className="mt-3">Run it yourself:</p>
      <pre className="bg-surface-2 rounded-inset text-fg mt-1.5 overflow-x-auto px-3 py-2 text-[12.5px]">
        {replayCommand(id)}
      </pre>
    </section>
  );
}
