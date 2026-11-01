import type { CSSProperties, ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import { embeddedEmailCss, embeddedEmailHtml } from "@/lib/email/embed";
import { caps } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  delayLabel,
  emailKindLabel,
  emailTiming,
  fastestUrgent,
  OUTCOME_NONE,
  REPLAY_KICKER,
  REPLAY_METHOD,
  replayCommand,
  replayDays,
  replayEmailList,
  replayEmailsSentence,
  replaySpan,
  repoOutcomes,
  sampleRepos,
  shortDayLabel,
  summaryParts,
  timeLabel,
  tocSections,
  todoSteps,
  WEEKLY_TIMING,
  WORLD_LABEL,
  worldTimeLabel,
} from "@/replay/render";
import type { ReplayEmail, ReplayEntry, ReplayResult, WorldEvent } from "@/replay/types";

// A replay as the app renders it: the same page model and copy as docs/replay
// (src/replay/render.ts), in the Triage system. Hero, sticky contents on desktop, sample repos,
// a vertical timeline (time left, card right; each email folds open into its own branded
// layout, inline), and what each repo was told by which email.

/** The embedded emails' dark palette follows the app theme: the attribute, else the OS. */
const EMAIL_CSS = embeddedEmailCss(".mail-body", [
  { prefix: '[data-theme="dark"] ' },
  { media: "(prefers-color-scheme: dark)", prefix: ':root:not([data-theme="light"]) ' },
]);

export function ReplayEmailStyles() {
  return <style dangerouslySetInnerHTML={{ __html: EMAIL_CSS }} />;
}

export function ReplayHero({ result }: { result: ReplayResult }) {
  const s = result.scenario;
  const { lead } = summaryParts(s.summary);
  const emails = replayEmailList(result).length;
  const fastest = fastestUrgent(result);
  const outcomes = repoOutcomes(result);
  const told = outcomes.filter((o) => o.told.some((steps) => steps.length > 0)).length;
  const tiles = [
    { value: String(emails), caption: emails === 1 ? "email sent" : "emails sent", sec: false },
    ...(fastest === null
      ? []
      : [
          {
            value: delayLabel(fastest),
            caption: "fastest urgent email after its trigger",
            sec: true,
          },
        ]),
    { value: `${told}/${outcomes.length}`, caption: "sample repos given a step", sec: false },
  ];
  return (
    <header id="top" className="rise pt-8 pb-2 md:pt-12">
      <p className="text-fg-muted text-[13px]">{REPLAY_KICKER}</p>
      <h1 className="type-hero mt-3 mb-4 max-w-[22ch]">{s.title}</h1>
      <p className="max-w-[60ch] text-[16px] leading-[1.45] min-[560px]:text-[18px]">{lead}</p>
      <p className="text-fg-muted mt-2.5 text-[13px] tabular-nums">
        {replaySpan(result)} · {s.world.length} events · {s.repos.length} sample repos
      </p>
      <ul className="mt-6 grid grid-cols-2 gap-2 min-[560px]:grid-cols-[repeat(3,minmax(0,200px))]">
        {tiles.map((t) => (
          <li
            key={t.caption}
            className="bg-surface border-line rounded-tile grid gap-1.5 border px-4 py-3.5"
          >
            <span className={cn("type-stat", t.sec && "text-sec")}>{t.value}</span>
            <span className="text-fg-muted text-[12px]">{t.caption}</span>
          </li>
        ))}
      </ul>
    </header>
  );
}

/** The contents column (desktop) beside the page body. */
export function ReplayLayout({ result, children }: { result: ReplayResult; children: ReactNode }) {
  return (
    <div className="mt-12 grid gap-10 min-[980px]:grid-cols-[200px_minmax(0,1fr)]">
      <ReplayToc result={result} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function ReplayToc({ result }: { result: ReplayResult }) {
  const link =
    "text-fg-muted hover:text-fg hover:bg-surface block rounded-[8px] px-2 py-1 transition-colors duration-150";
  return (
    <nav aria-label="On this page" className="hidden min-[980px]:block">
      <div className="sticky top-6 text-[13px]">
        <p className="type-label text-fg-muted mb-2.5 px-2">{caps("On this page")}</p>
        <ol className="grid gap-0.5">
          {tocSections(result).map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className={link}>
                {s.label}
              </a>
              {s.sub && (
                <ol className="border-line my-0.5 ml-2.5 grid gap-0.5 border-l pl-2.5">
                  {s.sub.map((d) => (
                    <li key={d.id}>
                      <a href={`#${d.id}`} className={cn(link, "tabular-nums")}>
                        {d.label}
                      </a>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mb-14 scroll-mt-4">
      <h2 id={`${id}-title`} className="type-h2 mb-3.5">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function ReplayOverview({ result }: { result: ReplayResult }) {
  const { rest } = summaryParts(result.scenario.summary);
  return (
    <Section id="overview" title="What Briff would have sent">
      {rest && <p className="max-w-[72ch] text-[15px] leading-[1.6]">{rest}</p>}
      <p className="text-fg-muted mt-2.5 max-w-[72ch] text-[15px] leading-[1.6]">
        {replayEmailsSentence(replayEmailList(result).length)} Open an email card to read it as it
        arrived.
      </p>
    </Section>
  );
}

export function SampleRepos({ result }: { result: ReplayResult }) {
  return (
    <Section id="repos" title="Sample repos">
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
        {sampleRepos(result).map((r) => (
          <li key={r.name}>
            <Card className="grid h-full content-start gap-2 p-[15px] min-[560px]:p-[18px]">
              <b className="font-mono text-[13px] font-medium">{r.name}</b>
              <pre className="bg-surface-2 rounded-inset px-2.5 py-2 text-[12.5px] leading-[1.45] break-words whitespace-pre-wrap">
                {r.files}
              </pre>
              <span className="text-fg-muted font-mono text-[12px]">Scanned: {r.runs}</span>
            </Card>
          </li>
        ))}
      </ul>
    </Section>
  );
}

const DOT: Record<"world" | ReplayEmail["kind"], string> = {
  world: "bg-surface border-wait",
  urgent: "bg-sec border-sec",
  weekly: "bg-brand border-brand",
};

function TimelineRow({
  time,
  dateTime,
  kind,
  children,
}: {
  time: string;
  dateTime: string;
  kind: keyof typeof DOT;
  children: ReactNode;
}) {
  return (
    <li className="group/ev grid min-[560px]:grid-cols-[96px_minmax(0,1fr)]">
      <div className="border-line border-l-2 pb-1.5 pl-[22px] min-[560px]:border-l-0 min-[560px]:pt-4 min-[560px]:pr-4 min-[560px]:pb-0 min-[560px]:pl-0 min-[560px]:text-right">
        <time
          dateTime={dateTime}
          className={cn(
            "font-mono text-[12.5px] font-medium tabular-nums",
            kind === "world" && "text-fg-muted"
          )}
        >
          {time}
        </time>
      </div>
      <div className="border-line relative min-w-0 border-l-2 pb-3.5 pl-[22px] group-last/ev:pb-0">
        <span
          aria-hidden
          className={cn(
            "absolute top-[-21px] left-[-7px] size-3 rounded-full border-2 min-[560px]:top-[19px]",
            DOT[kind]
          )}
        />
        {children}
      </div>
    </li>
  );
}

function WorldCard({ event }: { event: WorldEvent }) {
  return (
    <Card className="min-w-0 p-[15px] min-[560px]:px-[18px] min-[560px]:py-4">
      <Tag kind="wait">{WORLD_LABEL}</Tag>
      <h4 className="mt-2 text-[15px] leading-[1.35] font-medium text-balance">{event.title}</h4>
      {event.detail && (
        <p className="text-fg-muted mt-1.5 max-w-[72ch] text-[13.5px]">{event.detail}</p>
      )}
      <p className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px]">
        {event.sources.map((s) => (
          <a
            key={s.url}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="text-brand underline underline-offset-4"
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
  const timing = emailTiming(email);
  const steps = todoSteps(email);
  return (
    <details
      className={cn(
        "group/mail bg-surface border-line rounded-card min-w-0 border p-[15px] min-[560px]:px-[18px] min-[560px]:py-4",
        urgent && "border-t-sec border-t-[3px]"
      )}
    >
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px]">
          <Tag kind={urgent ? "security" : "brand"}>{emailKindLabel(email)}</Tag>
          <span className="text-fg-muted">
            {timing ? (
              <>
                <b className="text-sec font-semibold tabular-nums">{timing.delay}</b> {timing.after}
              </>
            ) : (
              WEEKLY_TIMING
            )}
          </span>
        </p>
        <h4 className="mt-2 text-[15px] leading-[1.35] font-medium text-balance">
          {email.subject}
        </h4>
        {steps.length > 0 && (
          <>
            <p className="type-label text-brand mt-3 mb-1">{caps("To do")}</p>
            <ul className="bg-surface-2 rounded-inset grid list-disc gap-1 py-2.5 pr-3 pl-7 text-[13px]">
              {steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </>
        )}
        <span className="text-brand mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium group-hover/mail:underline">
          <span className="group-open/mail:hidden">Show the email</span>
          <span className="hidden group-open/mail:inline">Hide the email</span>
          <span
            aria-hidden
            className="inline-block size-1.5 translate-y-[-2px] rotate-45 border-r-[1.5px] border-b-[1.5px] border-current group-open/mail:translate-y-px group-open/mail:-rotate-135"
          />
        </span>
      </summary>
      <div className="border-line rounded-inset mt-3.5 overflow-hidden border">
        <div className="bg-surface-2 border-line grid gap-0.5 border-b px-3.5 py-2.5 text-[13px] [overflow-wrap:anywhere]">
          <div>
            <span className="text-fg-muted inline-block w-16">From</span>Briff
          </div>
          <div>
            <span className="text-fg-muted inline-block w-16">Subject</span>
            <strong className="font-semibold">{email.subject}</strong>
          </div>
        </div>
        {/* Our own template's output over committed fixtures; every value in it is escaped. */}
        <div
          className="mail-body overflow-x-auto"
          dangerouslySetInnerHTML={{ __html: embeddedEmailHtml(email.html) }}
        />
      </div>
    </details>
  );
}

function Row({ entry }: { entry: ReplayEntry }) {
  if (entry.worldEvent) {
    const e = entry.worldEvent;
    return (
      <TimelineRow time={worldTimeLabel(e)} dateTime={e.at.toISOString()} kind="world">
        <WorldCard event={e} />
      </TimelineRow>
    );
  }
  if (entry.briffEmail) {
    const m = entry.briffEmail;
    return (
      <TimelineRow time={timeLabel(m.at)} dateTime={m.at.toISOString()} kind={m.kind}>
        <EmailCard email={m} />
      </TimelineRow>
    );
  }
  return null;
}

export function ReplayTimeline({ result }: { result: ReplayResult }) {
  return (
    <Section id="timeline" title="Timeline">
      {replayDays(result).map((day, i) => (
        <section
          key={day.id}
          id={day.id}
          aria-label={day.label}
          className="rise scroll-mt-4"
          style={{ "--i": Math.min(i + 2, 10) } as CSSProperties}
        >
          <h3
            className={cn(
              "text-fg-muted mb-3 text-[13px] font-semibold tabular-nums",
              i > 0 && "mt-7"
            )}
          >
            {day.label}
          </h3>
          <ol>
            {day.entries.map((e, j) => (
              <Row key={j} entry={e} />
            ))}
          </ol>
        </section>
      ))}
    </Section>
  );
}

export function OutcomeTable({ result }: { result: ReplayResult }) {
  const emails = replayEmailList(result);
  return (
    <Section id="outcome" title="What each repo was told, and when">
      <div className="bg-surface border-line rounded-card overflow-x-auto border">
        <table className="w-full min-w-[600px] table-fixed border-collapse text-[13px] min-[560px]:min-w-[720px]">
          <thead>
            <tr className="bg-surface-2">
              <th
                scope="col"
                className="bg-surface-2 text-fg-muted sticky left-0 z-[1] w-[150px] px-3.5 py-3 text-left align-top font-medium min-[560px]:w-[220px]"
              >
                Repo
              </th>
              {emails.map((m) => (
                <th
                  key={m.at.toISOString()}
                  scope="col"
                  className="text-fg-muted px-3.5 py-3 text-left align-top font-medium"
                >
                  <Tag kind={m.kind === "urgent" ? "security" : "brand"}>{emailKindLabel(m)}</Tag>
                  <span className="mt-1.5 block font-mono text-[12px] tabular-nums">
                    {shortDayLabel(m.at)} · {timeLabel(m.at)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {repoOutcomes(result).map((o) => (
              <tr key={o.repo} className="border-line border-t">
                <th
                  scope="row"
                  className="bg-surface sticky left-0 px-3.5 py-3 text-left align-top font-normal"
                >
                  <b className="block font-mono text-[13px] font-medium">{o.repo}</b>
                  <span className="text-fg-muted font-mono text-[12px]">{o.runs}</span>
                </th>
                {o.told.map((steps, i) => (
                  <td key={i} className="px-3.5 py-3 align-top">
                    {steps.length === 0 ? (
                      <span className="text-fg-muted">{OUTCOME_NONE}</span>
                    ) : (
                      <ul className="grid list-disc gap-1 pl-4">
                        {steps.map((s, j) => (
                          <li key={j}>{s}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export function ReplayMethod({ id }: { id: string }) {
  return (
    <Section id="method" title="How this replay works">
      <div className="text-fg-muted max-w-[72ch] text-[14px] leading-[1.6]">
        <p>{REPLAY_METHOD}</p>
        <p className="mt-3">Run it yourself:</p>
        <pre className="bg-surface-2 rounded-inset text-fg mt-1.5 overflow-x-auto px-3 py-2 text-[12.5px]">
          {replayCommand(id)}
        </pre>
      </div>
    </Section>
  );
}
