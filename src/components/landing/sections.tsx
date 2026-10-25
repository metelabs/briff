import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { BulletinContent } from "@/components/bulletin/bulletin-content";
import { MailFrame } from "@/components/replay/mail-frame";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { CodeBlock, CommandBox } from "@/components/ui/command-box";
import { CountBadge } from "@/components/ui/section-header";
import { Tag } from "@/components/ui/tag";
import { shortDate } from "@/lib/format";
import { caps, strings } from "@/lib/i18n";
import { localScanCommands, scanWorkflowYaml, WORKFLOW_PATH } from "@/lib/scan/workflow";
import { cn } from "@/lib/utils";
import type { BulletinView } from "@/pipeline/bulletin-model";
import type { ReplayHighlight } from "@/replay/public";
import { delayLabel, timeLabel } from "@/replay/render";
import type { ReplayEmail } from "@/replay/types";

import { PRIVACY_URL, SELF_HOST_URL } from "./links";
import type { ScannedFileList } from "./scanned-files";

// The landing page's sections. Everything they show comes from props the page builds from
// the replays and the scanner's lists; nothing here reads a session or the database.

const rise = (i: number): CSSProperties => ({ "--i": i }) as CSSProperties;

function SectionHead({
  id,
  title,
  count,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <div className="rise mb-5 max-w-[72ch]">
      <div className="flex items-center gap-2">
        <h2 id={id} className="type-page scroll-mt-6 text-[clamp(24px,3vw,32px)]">
          {title}
        </h2>
        {count !== undefined && <CountBadge>{count}</CountBadge>}
      </div>
      <p className="text-fg-muted mt-2 text-[15px]">{children}</p>
    </div>
  );
}

export interface HeroStat {
  value: string;
  caption: string;
  href: string;
  security: boolean;
}

export function Hero({ stats }: { stats: HeroStat[] }) {
  return (
    <section className="grid items-end gap-10 pt-10 pb-14 min-[980px]:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] min-[980px]:pb-20 md:pt-16">
      <div className="min-w-0">
        <p className="rise text-fg-muted text-[13px]">
          Weekly on Monday · security the same day · email only
        </p>
        <h1
          className="rise font-display mt-4 max-w-[24ch] text-[clamp(31px,4.4vw,50px)] leading-[1.04] font-semibold tracking-[-0.035em] text-balance [--i:1]"
          style={{ fontVariationSettings: '"opsz" 96' }}
        >
          A weekly briefing of what changed in the packages and runtimes your repos actually run,
          and a same-day email when a <span className="text-sec">security fix</span> lands for one
          of them.
        </h1>
        <p className="rise text-fg-muted mt-5 max-w-[56ch] text-[16px] [--i:2]">
          Briff reads lockfiles, version files and Dockerfiles, never your code. It follows the
          release notes and advisories of what they name and tells you which repo needs which
          command.
        </p>
        <div className="rise mt-7 flex flex-wrap items-center gap-2.5 [--i:3]">
          <Link href="/login" className={buttonVariants({ variant: "primary", size: "lg" })}>
            Sign in
            <ArrowRight className="size-4" aria-hidden />
          </Link>
          <a
            href={SELF_HOST_URL}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: "secondary", size: "lg" })}
          >
            Self-host
            <ArrowUpRight className="text-fg-muted size-4" aria-hidden />
          </a>
        </div>
        <p className="rise text-fg-muted mt-3 max-w-[56ch] text-[12.5px] [--i:4]">
          Sign-ups are closed for now. Ask for an account, or run your own: one Docker image and
          Postgres, configured with environment variables.
        </p>
      </div>
      <ul className="grid gap-2 min-[560px]:grid-cols-3 min-[980px]:grid-cols-1">
        {stats.map((s, i) => (
          <li key={s.caption} className="rise" style={rise(i + 3)}>
            <a
              href={s.href}
              className="bg-surface border-line hover:border-line-strong hover:shadow-lift ease-entrance rounded-tile grid h-full grid-cols-[8rem_minmax(0,1fr)] items-baseline gap-3 border px-4 py-3.5 transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 min-[560px]:grid-cols-1 min-[560px]:gap-2 min-[980px]:grid-cols-[8rem_minmax(0,1fr)] min-[980px]:gap-3"
            >
              <b className={cn("type-stat whitespace-nowrap", s.security ? "text-sec" : "text-fg")}>
                {s.value}
              </b>
              <span className="text-fg-muted text-[13px] leading-[1.35]">{s.caption}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface ReplayCardData {
  id: string;
  title: string;
  lead: string;
  emails: number;
  highlights: ReplayHighlight[];
}

/** "20 Oct 20:32 UTC". */
function dayTime(d: Date): string {
  return `${shortDate(d).slice(4)} ${timeLabel(d)}`;
}

function ReplayCard({ data, index }: { data: ReplayCardData; index: number }) {
  return (
    <article
      className="rise bg-surface border-line border-t-sec rounded-card flex min-w-0 flex-col border border-t-[3px] p-[15px] min-[560px]:p-[18px]"
      style={rise(index + 1)}
    >
      <div className="flex items-center justify-between gap-2">
        <Tag kind="security">Security</Tag>
        <span className="text-fg-muted text-[12.5px]">
          {data.emails} emails, replayed hour by hour
        </span>
      </div>
      <h3 className="type-h3 mt-2.5">{data.title}</h3>
      <p className="text-fg-muted mt-1.5 text-[13.5px]">{data.lead}</p>
      <ol className="mt-4 grid gap-3">
        {data.highlights.map((h) => (
          <li
            key={h.email.at.toISOString()}
            className="bg-surface-2 rounded-inset grid gap-2 px-3.5 py-3"
          >
            <div className="grid gap-x-3 gap-y-0.5 text-[13px] min-[560px]:grid-cols-[8.5rem_minmax(0,1fr)]">
              <time
                dateTime={h.trigger.at.toISOString()}
                className="text-fg-muted font-mono text-[12px] leading-[1.6] tabular-nums"
              >
                {dayTime(h.trigger.at)}
              </time>
              <span className="text-fg-muted">
                Published: <span className="text-fg">{h.trigger.title}</span>
              </span>
            </div>
            <div className="grid gap-x-3 gap-y-0.5 text-[13px] min-[560px]:grid-cols-[8.5rem_minmax(0,1fr)]">
              <time
                dateTime={h.email.at.toISOString()}
                className="text-fg font-mono text-[12px] leading-[1.6] font-medium tabular-nums"
              >
                {dayTime(h.email.at)}
              </time>
              <span>
                <b className="text-sec font-semibold tabular-nums">
                  {delayLabel(h.email.delayMinutes)}
                </b>{" "}
                Briff emails: <span className="font-medium">{h.email.subject}</span>
              </span>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-auto pt-4 text-[13.5px] font-medium">
        <Link
          href={`/replay/${data.id}`}
          className="text-brand inline-flex items-center gap-1 underline-offset-4 hover:underline"
        >
          Open the replay
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </article>
  );
}

export function ReplaysSection({ cards }: { cards: ReplayCardData[] }) {
  return (
    <section className="pb-16">
      <SectionHead id="replays" title="What Briff would have sent" count={cards.length}>
        Two real incidents from October 2026, replayed through Briff&apos;s own pipeline: the items
        the vendors published, with their timestamps, sample repos, and the production email
        templates. No model is involved in a security email.
      </SectionHead>
      <div className="grid items-stretch gap-3 min-[768px]:grid-cols-2">
        {cards.map((c, i) => (
          <ReplayCard key={c.id} data={c} index={i} />
        ))}
      </div>
    </section>
  );
}

function PathCard({
  title,
  tag,
  index,
  children,
}: {
  title: string;
  tag?: string;
  index: number;
  children: ReactNode;
}) {
  return (
    <Card
      className="rise flex min-w-0 flex-col gap-3 p-[15px] min-[560px]:p-[18px]"
      style={rise(index)}
    >
      <div className="flex min-h-[22px] items-center justify-between gap-2">
        <h3 className="type-h3">{title}</h3>
        {tag && <Tag kind="brand">{tag}</Tag>}
      </div>
      {children}
    </Card>
  );
}

export function ReadsSection({ files, apiUrl }: { files: ScannedFileList; apiUrl: string }) {
  const commands = localScanCommands(apiUrl, "brf_…");
  return (
    <section className="pb-16">
      <SectionHead id="reads" title="How it reads your repos">
        Three ways in, one list of files. Each path parses the same files into package, version and
        runtime rows with the same code, and never reads source code.
      </SectionHead>
      <div className="grid gap-3 min-[980px]:grid-cols-3">
        <PathCard title="GitHub App" tag="Recommended" index={1}>
          <p className="text-[14px]">
            Install it on the repos you pick, from Settings after you sign in. Permissions: contents
            and metadata, read-only. Briff reads the default branch&apos;s list of paths, fetches
            only the files below, and rescans when a push changes one of them.
          </p>
        </PathCard>
        <PathCard title="GitHub Action" index={2}>
          <p className="text-[14px]">
            One workflow per repo. The scanner runs in your CI and uploads the rows with a scan
            token from Settings; nothing else leaves the runner.
          </p>
          <details className="group/wf mt-auto">
            <summary className="text-brand cursor-pointer text-[13px] font-medium marker:content-none">
              <span className="group-open/wf:hidden">Show</span>
              <span className="hidden group-open/wf:inline">Hide</span> {WORKFLOW_PATH}
            </summary>
            <CodeBlock className="mt-2" label={WORKFLOW_PATH} code={scanWorkflowYaml(apiUrl)} />
          </details>
        </PathCard>
        <PathCard title="Local CLI" index={3}>
          <p className="text-[14px]">
            On a laptop or a build box, in one repo or every repo under a folder.{" "}
            <code className="font-mono text-[13px]">--dry-run</code> prints what would be sent and
            sends nothing.
          </p>
          <CommandBox className="mt-auto" command={commands.dryRun} />
        </PathCard>
      </div>

      <Card className="rise mt-3 p-[15px] [--i:4] min-[560px]:p-[18px]">
        <div className="grid gap-5 min-[980px]:grid-cols-[minmax(0,1fr)_minmax(0,2.2fr)]">
          <div className="min-w-0">
            <h3 className="type-h3">The files it reads</h3>
            <p className="text-fg-muted mt-2 text-[13.5px]">
              Only these names, at most {files.maxDepth} directories deep, never inside{" "}
              {files.skippedDirs.join(", ")} or a directory whose name starts with a dot.
            </p>
            <p className="mt-3 text-[13.5px]">
              <b className="font-semibold">Never read:</b> source code, READMEs, workflows,
              environment files, issues, pull requests or git history. File contents become rows and
              are not stored.
            </p>
          </div>
          <div className="min-w-0">
            <ul className="flex flex-wrap gap-1.5" aria-label="File names">
              {files.names.map((n) => (
                <li key={n}>
                  <Chip>{n}</Chip>
                </li>
              ))}
            </ul>
            <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="File name patterns">
              {files.patterns.map((p) => (
                <li key={p}>
                  <Chip className="text-fg-muted border-dashed">{p}</Chip>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>
    </section>
  );
}

export function SampleSection({
  view,
  alert,
  replayId,
}: {
  view: BulletinView;
  alert: ReplayEmail;
  replayId: string;
}) {
  return (
    <section className="pb-16">
      <SectionHead id="sample" title="What a bulletin looks like">
        The Monday bulletin and the security email from the PHP2Shell replay, for three sample
        repos, rendered by the same components and templates as the app. In production a model
        writes the headline, one line per item and the good-to-know list; here the item title stands
        in.
      </SectionHead>

      <div className="rise border-line bg-surface-2 rounded-card overflow-hidden border [--i:1]">
        <div className="border-line bg-surface flex items-center gap-3 border-b px-4 py-2.5">
          <span className="text-fg-muted min-w-0 truncate font-mono text-[12px]">
            {view.streamName} bulletin · {shortDate(view.createdAt)}
          </span>
          <Link
            href={`/replay/${replayId}`}
            className="text-brand ml-auto shrink-0 text-[12.5px] font-medium underline-offset-4 hover:underline"
          >
            Where it comes from
          </Link>
        </div>
        <div className="bg-bg px-[15px] pb-6 min-[560px]:px-6">
          <BulletinContent
            view={view}
            t={strings(view.language)}
            feedback={null}
            notice={null}
            signedIn={false}
            headlineAs="h3"
          />
        </div>
      </div>

      <div className="mt-8 grid gap-5 min-[980px]:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className="rise min-w-0 [--i:2]">
          <h3 className="type-h3">The security email</h3>
          <p className="text-fg-muted mt-2 text-[14px]">
            Sent on the first hourly run after the fix is public: what each repo runs, the fixed
            versions, one step per repo and every source folded into one block. A repo on an
            end-of-life line is told to migrate, never handed a command for a major it is not on.
          </p>
          <p className="text-fg-muted mt-3 font-mono text-[12.5px] tabular-nums">
            {shortDate(alert.at)} · {timeLabel(alert.at)}
            {alert.delayMinutes !== null && ` · ${delayLabel(alert.delayMinutes)}`}
          </p>
        </div>
        <div className="rise min-w-0 [--i:3]">
          <MailFrame subject={alert.subject} html={alert.html} className="bg-surface" />
        </div>
      </div>
    </section>
  );
}

export function PrivacySection() {
  const rows = [
    {
      to: "api.anthropic.com",
      gets: "Public release notes and advisories, package names and versions, repo aliases (repo-1, repo-2)",
      never: "Repo names, emails, tokens",
    },
    {
      to: "api.osv.dev",
      gets: "Ecosystem, package name and installed version",
      never: "Repo names",
    },
    { to: "registry.npmjs.org", gets: "A package name", never: "Your versions, repo names" },
    {
      to: "github.com",
      gets: "Requests for public release feeds and advisories; with the App, the listed files of the repos you picked",
      never: "Your other repos or files",
    },
    { to: "Your SMTP relay", gets: "The email itself", never: "Tokens, password hashes" },
  ];
  return (
    <section className="pb-20">
      <SectionHead id="privacy" title="What leaves your server">
        Briff keeps repo names and the package, version and runtime rows from your files. These are
        its only outbound connections; self-hosted, leave the Anthropic key empty and nothing goes
        there, leave SMTP empty and no email leaves.
      </SectionHead>
      <Card className="rise overflow-hidden [--i:1]">
        <div className="bg-surface-2 text-fg-muted type-label hidden grid-cols-[minmax(0,0.9fr)_minmax(0,2fr)_minmax(0,1.1fr)] gap-4 px-[18px] py-2.5 min-[768px]:grid">
          <span>{caps("Recipient")}</span>
          <span>{caps("Receives")}</span>
          <span>{caps("Never")}</span>
        </div>
        {rows.map((r, i) => (
          <div
            key={r.to}
            className={cn(
              "border-line grid gap-1 border-t px-[18px] py-3 text-[13.5px] min-[768px]:grid-cols-[minmax(0,0.9fr)_minmax(0,2fr)_minmax(0,1.1fr)] min-[768px]:gap-4",
              i === 0 && "max-[767px]:border-t-0"
            )}
          >
            <span className="font-mono text-[12.5px] font-medium">{r.to}</span>
            <span>{r.gets}</span>
            <span className="text-fg-muted">
              <span className="min-[768px]:hidden">Never: </span>
              {r.never}
            </span>
          </div>
        ))}
      </Card>
      <p className="rise mt-3 text-[13.5px] [--i:2]">
        <a
          href={PRIVACY_URL}
          target="_blank"
          rel="noreferrer"
          className="text-brand inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline"
        >
          The full list, with the code behind each claim
          <ArrowUpRight className="size-3.5" aria-hidden />
        </a>
      </p>
    </section>
  );
}
