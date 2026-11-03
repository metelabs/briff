import { BaseImageAdvisories } from "@/components/base-image-advisories";
import Link from "next/link";
import { Fragment, type CSSProperties, type ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { CollapsedList } from "@/components/ui/collapsed-list";
import { CommandBox, InlineCopy } from "@/components/ui/command-box";
import { CountBadge, SectionHeader, WeekPill } from "@/components/ui/section-header";
import { severityKind, Tag, type TagKind } from "@/components/ui/tag";
import { TruncatedText } from "@/components/ui/tooltip";
import { UpgradeList } from "@/components/ui/upgrade-list";
import { plural, shortDate } from "@/lib/format";
import { caps, todoLabel, type Language, type Strings } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  actionClauses,
  groupByRepo,
  repoAnchor,
  repoFixLines,
  type RepoEntry,
  type RepoGroup,
} from "@/pipeline/bulletin-by-repo";
import {
  advisoryCount,
  allItems,
  BULLETIN_ALERT_LIMIT,
  CONDENSED_NOTE,
  restCount,
  type BulletinView,
  type BulletinViewAlert,
  type BulletinViewItem,
} from "@/pipeline/bulletin-model";
import { osvLink, severityLabel } from "@/security/plan";

import {
  BulletinPivot,
  CountTile,
  FoldedBar,
  PivotPane,
  PivotTabs,
  RepoChip,
  RepoChips,
} from "./pivot-client";
import { hasClickableRepo, repoNamesOf, type RepoName } from "./pivot";

// The bulletin as /b/<id> renders it, from a BulletinView alone: no database, no session.
// The page passes the feedback trio (a Server Action); the landing page's sample has none.

/** Renders an item's feedback trio; null leaves it out. */
export type FeedbackSlot = ((itemId: string, className?: string) => ReactNode) | null;

export function BulletinContent({
  view,
  t,
  feedback,
  notice,
  signedIn,
  headlineAs: Headline_ = "h1",
}: {
  view: BulletinView;
  t: Strings;
  feedback: FeedbackSlot;
  notice: "saved" | "invalid" | null;
  signedIn: boolean;
  /** The landing page embeds a bulletin under its own h1. */
  headlineAs?: "h1" | "h3";
}) {
  const securityAct = view.act.filter((i) => i.bucket === "security").length;
  const newAdvisories = advisoryCount(view.alerts);
  const folded = restCount(view);
  const groups = groupByRepo(view, t);
  const repoCards = new Set(groups.flatMap((g) => (g.repo ? [g.repo] : [])));
  const repoNames = (item: BulletinViewItem): RepoName[] =>
    repoNamesOf(item.affectedRepos, repoCards);
  const anyClickable = hasClickableRepo(allItems(view), repoCards);
  // "Repo names are clickable" sits once, next to the first chip row of the page.
  const chipHintItem = view.act.find((i) => i.affectedRepos.length > 0)?.itemId ?? null;
  const restRows = view.rest.length + view.minor.length;
  const minorLeft = Math.max(0, view.minorCount - view.minor.length);
  const minorNote =
    minorLeft === 0 ? null : view.minor.length > 0 ? t.minor_more(minorLeft) : t.minor(minorLeft);

  return (
    <article className="min-w-0 [overflow-wrap:anywhere]" lang={view.language}>
      <BulletinPivot>
        <section className="grid items-end gap-7 pt-7 pb-[26px] min-[980px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <div className="rise min-w-0">
            <div className="text-fg-muted flex flex-wrap items-center gap-2 text-[13px]">
              <WeekPill>{view.weekLabel}</WeekPill>
              {view.streamName && <span className="text-fg font-medium">{view.streamName}</span>}
              <span>
                {view.emailSentAt ? `Emailed ${shortDate(view.emailSentAt)}` : "Not emailed"}
              </span>
              {signedIn && (
                <>
                  <span aria-hidden>·</span>
                  <Link href="/bulletins" className="underline underline-offset-2">
                    All bulletins
                  </Link>
                </>
              )}
            </div>
            <Headline_ className="type-hero my-3.5">
              <Headline count={view.act.length} security={securityAct > 0} />
            </Headline_>
            {view.summary && (
              <p className="text-fg-muted max-w-[56ch] text-[16px]">{view.summary}</p>
            )}
            {view.condensed && (
              <p className="text-fg-muted mt-3 max-w-[56ch] text-[12.5px]">{CONDENSED_NOTE}</p>
            )}
            {notice && (
              <p
                role="status"
                className={cn(
                  "mt-4 rounded-[10px] px-3 py-2 text-[13.5px]",
                  notice === "saved" ? "bg-ok-soft text-ok" : "bg-upgrade-soft text-upgrade"
                )}
              >
                {notice === "saved" ? t.feedback_saved : t.feedback_invalid}
              </p>
            )}
          </div>
          <div className="rise grid grid-cols-2 gap-2 [--i:1] min-[560px]:grid-cols-4">
            <CountTile
              bulletinId={view.id}
              value={view.act.length}
              caption="need your attention"
              alarm={securityAct > 0}
              target="attention"
            />
            <CountTile
              bulletinId={view.id}
              value={view.know.length}
              caption="good to know"
              alarm={false}
              target="know"
            />
            <CountTile
              bulletinId={view.id}
              value={newAdvisories}
              caption={newAdvisories === 1 ? "new advisory" : "new advisories"}
              alarm={newAdvisories > 0}
              target="advisories"
            />
            <CountTile
              bulletinId={view.id}
              value={folded}
              caption="folded away"
              alarm={false}
              target="folded"
            />
          </div>
        </section>

        <div className="rise mb-4 flex flex-wrap items-center justify-between gap-3 [--i:2]">
          <PivotTabs />
          {anyClickable && (
            <PivotPane when="item">
              <span className="text-fg-muted hidden text-[13px] min-[560px]:inline">
                Click a repo name to see everything for that repo
              </span>
            </PivotPane>
          )}
        </div>

        <PivotPane when="item">
          <div className="grid items-start gap-[18px] min-[980px]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <SectionHeader id="attention" title={t.act_title} count={view.act.length} />
              {view.act.length === 0 ? (
                <Card className="rise text-fg-muted px-[18px] py-5 [--i:3]">{t.nothing_to_do}</Card>
              ) : (
                view.act.map((item, i) => (
                  <ActCard
                    key={item.itemId}
                    item={item}
                    index={i}
                    t={t}
                    language={view.language}
                    feedback={feedback}
                    chipHint={item.itemId === chipHintItem}
                  />
                ))
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <div>
                <SectionHeader id="know" title={t.know_title} count={view.know.length} />
                {view.know.length > 0 ? (
                  <Card className="rise overflow-hidden [--i:4]">
                    {view.know.map((item) => (
                      <KnowRow
                        key={item.itemId}
                        item={item}
                        repos={repoNames(item)}
                        language={view.language}
                        t={t}
                        feedback={feedback}
                      />
                    ))}
                  </Card>
                ) : (
                  <Card className="rise text-fg-muted px-[18px] py-5 [--i:4]">
                    Nothing else worth your time this week.
                  </Card>
                )}
              </div>
              <BaseImageAdvisories groups={view.baseImageAlerts ?? []} />
              <AdvisoriesCard view={view} t={t} signedIn={signedIn} />
              {folded > 0 && (
                <div className="rise [--i:6]">
                  <FoldedBar count={folded} note={minorNote ?? undefined}>
                    {restRows > 0 ? (
                      <RestList
                        view={view}
                        t={t}
                        language={view.language}
                        feedback={feedback}
                        repoNames={repoNames}
                        minorNote={minorNote}
                      />
                    ) : undefined}
                  </FoldedBar>
                </div>
              )}
            </div>
          </div>
        </PivotPane>

        <PivotPane when="repo">
          <RepoGrid groups={groups} t={t} />
        </PivotPane>
      </BulletinPivot>
    </article>
  );
}

/** Lead with the answer: how many items need the reader. */
function Headline({ count, security }: { count: number; security: boolean }) {
  if (count === 0) return <>Nothing needs your attention.</>;
  return (
    <>
      <span className={security ? "text-sec" : undefined}>{plural(count, "item")}</span>{" "}
      {count === 1 ? "needs" : "need"} your attention.
    </>
  );
}

function actTag(item: BulletinViewItem, t: Strings, language: Language): [TagKind, string] {
  if (item.bucket === "security") return ["security", t.section_security];
  if (item.bucket === "deadline") return ["upgrade", t.due];
  if (item.todo) return [todoKind(item.todo), todoLabel(language, item.todo)];
  return ["brand", t.todo];
}

function todoKind(todo: NonNullable<BulletinViewItem["todo"]>): TagKind {
  if (todo === "upgrade") return "upgrade";
  if (todo === "read") return "read";
  return "wait";
}

const INLINE_COMMAND =
  /(\b(?:(?:npm|npx) (?:ls|i|install)|composer (?:why|require)|pipdeptree -r -p|uv tree --invert --package|uv add|uv lock --upgrade-package|poetry add|pipenv install|pip install|go get|go mod edit|go mod why -m) [^\s),;]+)/g;

/** A sentence with the commands it names set as inline code. */
function Prose({ text }: { text: string }) {
  const parts = text.split(INLINE_COMMAND);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <code
            key={i}
            className="bg-surface border-line rounded-[5px] border px-[5px] text-[12.5px]"
          >
            {part}
          </code>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  );
}

function FixBox({
  action,
  label,
  upgrades,
}: {
  action: string;
  label: string;
  upgrades: BulletinViewItem["upgrades"];
}) {
  const clauses = actionClauses(action);
  const lines = repoFixLines({ action, upgrades });
  if (clauses.length === 0) return null;
  return (
    <div className="bg-surface-2 rounded-inset mt-3.5 grid gap-2 py-3 pr-3 pl-3.5">
      <small className="type-label text-brand tracking-[0.06em]">{caps(label)}</small>
      {clauses.map((c, i) =>
        c.kind === "command" ? (
          <div key={i} className="grid gap-1">
            <CommandBox command={c.command} />
            {c.repos.length > 0 && (
              <span className="text-fg-muted text-[12.5px]">Run in {c.repos.join(", ")}</span>
            )}
          </div>
        ) : (
          <p key={i} className="leading-normal">
            <Prose text={c.text} />
          </p>
        )
      )}
      <CollapsedList
        listClassName="grid gap-1"
        moreLabel={(_, total) => `Show all ${total}`}
        rows={lines.map((l, i) => ({
          key: `${l.upgrade.repo}-${i}`,
          node: (
            <div className="grid justify-items-start gap-1">
              <UpgradeList upgrades={[l.upgrade]} />
              {l.action && (
                <InlineCopy text={l.action.text} command={l.action.kind === "command"} />
              )}
            </div>
          ),
        }))}
      />
    </div>
  );
}

function ActCard({
  item,
  index,
  t,
  language,
  feedback,
  chipHint,
}: {
  item: BulletinViewItem;
  index: number;
  t: Strings;
  language: Language;
  feedback: FeedbackSlot;
  chipHint: boolean;
}) {
  const [kind, label] = actTag(item, t, language);
  return (
    <article
      id={`item-${item.itemId}`}
      style={{ "--i": index + 3 } as CSSProperties}
      className={cn(
        "rise bg-surface border-line hover:shadow-raised ease-entrance rounded-card mb-3 scroll-mt-24 border p-[15px] transition-[box-shadow,transform] duration-250 hover:-translate-y-px min-[560px]:p-[18px]",
        item.bucket === "security" && "border-t-sec border-t-[3px]",
        item.bucket === "deadline" && "border-t-upgrade border-t-[3px]"
      )}
    >
      <Tag kind={kind}>{label}</Tag>
      <h3 className="type-h3 mt-2.5 mb-3">{item.headline}</h3>
      {item.affectedRepos.length > 0 && (
        <div className="flex flex-wrap items-center gap-[5px]">
          <div className="contents" role="group" aria-label={t.affected}>
            {item.affectedRepos.map((r) => (
              <RepoChip key={r} repo={r} />
            ))}
          </div>
          {chipHint && (
            <span className="text-fg-muted ml-1 text-[12px]">repo names are clickable</span>
          )}
        </div>
      )}
      {item.line && <p className="text-fg-muted mt-2.5 text-[13.5px]">{item.line}</p>}
      {item.dueAt && (
        <p className="mt-2 text-[13.5px]">
          {t.due} <strong>{item.dueAt.toISOString().slice(0, 10)}</strong>{" "}
          <span className="text-fg-muted">({t.estimated})</span>
        </p>
      )}
      {item.action && (
        <FixBox
          action={item.action}
          label={item.bucket === "security" ? "Fix" : t.todo}
          upgrades={item.upgrades}
        />
      )}
      <div className="text-fg-muted mt-3.5 flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
        <ItemLinks item={item} t={t} />
        {feedback?.(item.itemId)}
      </div>
    </article>
  );
}

function KnowRow({
  item,
  repos,
  language,
  t,
  feedback,
}: {
  item: BulletinViewItem;
  repos: RepoName[];
  language: Language;
  t: Strings;
  feedback: FeedbackSlot;
}) {
  const kind = item.todo ? todoKind(item.todo) : "read";
  return (
    <div
      id={`item-${item.itemId}`}
      className="group/ki border-line hover:bg-surface-2 grid scroll-mt-24 gap-2 border-t px-4 py-3.5 transition-colors duration-150 first:border-t-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tag kind={kind}>{item.todo ? todoLabel(language, item.todo) : t.know_title}</Tag>
        {repos.length > 0 && <RepoChips repos={repos} label={t.affected} />}
      </div>
      <h4 className="text-[15px] leading-[1.35] font-medium">
        <a href={item.url} target="_blank" rel="noreferrer" className="hover:underline">
          {item.headline}
        </a>
      </h4>
      {item.line && <p className="text-fg-muted text-[13px]">{item.line}</p>}
      {item.action && <p className="text-[13px]">{item.action}</p>}
      <UpgradeList upgrades={item.upgrades} />
      {feedback?.(
        item.itemId,
        "transition-opacity duration-200 min-[560px]:opacity-50 min-[560px]:group-focus-within/ki:opacity-100 min-[560px]:group-hover/ki:opacity-100 [@media(hover:none)]:opacity-100"
      )}
    </div>
  );
}

function ItemLinks({ item, t }: { item: BulletinViewItem; t: Strings }) {
  const groups = [
    { key: "release", label: t.also_released, items: item.folded.filter((f) => f.release) },
    { key: "related", label: t.related, items: item.folded.filter((f) => !f.release) },
  ].filter((g) => g.items.length > 0);
  return (
    <span className="min-w-0">
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="hover:text-fg underline-offset-2 hover:underline"
      >
        {item.sourceName}
      </a>
      {groups.map((g) => (
        <span key={g.key}>
          {" · "}
          {g.label}:{" "}
          {g.items.map((f, i) => (
            <Fragment key={f.url}>
              {i > 0 && ", "}
              <a
                href={f.url}
                target="_blank"
                rel="noreferrer"
                className="hover:text-fg underline-offset-2 hover:underline"
              >
                {f.title}
              </a>
            </Fragment>
          ))}
        </span>
      ))}
    </span>
  );
}

function AlertRows({ alerts, t }: { alerts: BulletinViewAlert[]; t: Strings }) {
  return (
    <>
      {alerts.slice(0, BULLETIN_ALERT_LIMIT).map((a) => (
        <div
          key={a.packageName}
          className="border-line grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 border-t py-[9px]"
        >
          <a
            href={osvLink(a.osvIds[0])}
            target="_blank"
            rel="noreferrer"
            className="font-mono font-medium hover:underline"
          >
            {a.packageName}
          </a>
          <span className="text-fg-muted text-[12.5px]">
            {[
              a.transitive ? t.transitive : null,
              t.advisories(a.osvIds.length),
              a.repos.join(", "),
              a.fixed ? `${t.fixed} ${a.fixed}` : a.noLineFix ? t.no_line_fix : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <Tag kind={severityKind(a.severity)}>{severityLabel(a.severity)}</Tag>
          <UpgradeList upgrades={a.installs} className="col-span-full -mt-1 text-[12px]" />
        </div>
      ))}
      {alerts.length > BULLETIN_ALERT_LIMIT && (
        <p className="text-fg-muted border-line border-t pt-2.5 text-[12.5px]">
          {t.alerts_not_listed(advisoryCount(alerts.slice(BULLETIN_ALERT_LIMIT)))}
        </p>
      )}
    </>
  );
}

function AdvisoriesCard({
  view,
  t,
  signedIn,
}: {
  view: BulletinView;
  t: Strings;
  signedIn: boolean;
}) {
  const backlog = advisoryCount(view.backlogAlerts);
  return (
    <Card id="advisories" className="rise scroll-mt-24 p-4 [--i:5]">
      <h4 className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold">
        {t.alerts_title}
        <CountBadge>{advisoryCount(view.alerts)}</CountBadge>
      </h4>
      {view.alerts.length > 0 ? (
        <AlertRows alerts={view.alerts} t={t} />
      ) : (
        <p className="text-fg-muted border-line border-t pt-2.5 text-[13px]">
          No new advisories for this stream&apos;s repos this week.
        </p>
      )}
      {backlog > 0 && (
        <details className="group/bl mt-2.5">
          <summary className="text-fg-muted hover:text-fg cursor-pointer text-[12.5px] marker:content-none">
            <span className="group-open/bl:hidden">Show </span>
            <span className="hidden group-open/bl:inline">Hide </span>
            {t.backlog_title(backlog).replace(/^Older/, "older")}
          </summary>
          <div className="mt-1.5">
            <AlertRows alerts={view.backlogAlerts} t={t} />
          </div>
        </details>
      )}
      {signedIn && (
        <p className="text-fg-muted mt-2.5 text-[12.5px]">
          Every advisory with its fix per repo:{" "}
          <Link href="/alerts" className="text-brand underline underline-offset-2">
            Alerts
          </Link>
        </p>
      )}
    </Card>
  );
}

function RestList({
  view,
  t,
  language,
  feedback,
  repoNames,
  minorNote,
}: {
  view: BulletinView;
  t: Strings;
  language: Language;
  feedback: FeedbackSlot;
  repoNames: (item: BulletinViewItem) => RepoName[];
  minorNote: string | null;
}) {
  const rows = [
    ...view.rest.map((item) => ({ item, tag: item.todo ? restTag(item.todo, language) : null })),
    ...view.minor.map((item) => ({ item, tag: ["wait", t.minor_label] as [TagKind, string] })),
  ];
  return (
    <div className="bg-surface border-line rounded-card mt-2 border">
      {rows.map(({ item, tag }) => {
        const repos = repoNames(item);
        return (
          <div
            key={item.itemId}
            id={`item-${item.itemId}`}
            className="group/ri border-line hover:bg-surface-2 grid scroll-mt-24 gap-1.5 border-t px-4 py-3 transition-colors duration-150 first:border-t-0"
          >
            {(tag || repos.length > 0) && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                {tag ? <Tag kind={tag[0]}>{tag[1]}</Tag> : <span />}
                {repos.length > 0 && <RepoChips repos={repos} label={t.affected} />}
              </div>
            )}
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="text-[14px] font-medium hover:underline"
            >
              {item.headline}
            </a>
            {item.line && <p className="text-fg-muted text-[13px]">{item.line}</p>}
            {feedback?.(
              item.itemId,
              "transition-opacity duration-200 min-[560px]:opacity-50 min-[560px]:group-focus-within/ri:opacity-100 min-[560px]:group-hover/ri:opacity-100 [@media(hover:none)]:opacity-100"
            )}
          </div>
        );
      })}
      {minorNote && (
        <p className="text-fg-muted border-line border-t px-4 py-3 text-[13px] first:border-t-0">
          {minorNote}
        </p>
      )}
    </div>
  );
}

function restTag(
  todo: NonNullable<BulletinViewItem["todo"]>,
  language: Language
): [TagKind, string] {
  return [todoKind(todo), todoLabel(language, todo)];
}

const DOT: Record<string, string> = {
  security: "bg-sec",
  deadline: "bg-upgrade",
  upgrade: "bg-upgrade",
  read: "bg-read",
  wait: "bg-wait",
  act: "bg-brand",
};

function RepoEntryRow({ entry: e }: { entry: RepoEntry }) {
  return (
    <div className="grid gap-1.5">
      <span className="grid grid-cols-[8px_minmax(0,1fr)] items-baseline gap-[9px] text-[14px] leading-[1.35] font-medium">
        <i aria-hidden className={cn("size-2 rounded-full", DOT[e.kind])} />
        <span>
          <span className="sr-only">{e.kind}: </span>
          {e.title}
        </span>
      </span>
      {(e.actions.length > 0 || e.upgrades.length > 0) && (
        <div className="ml-[17px] grid justify-items-start gap-1.5">
          {e.actions.map((a, j) =>
            a.kind === "command" || a.own ? (
              <InlineCopy key={j} text={a.text} command={a.kind === "command"} />
            ) : (
              <p key={j} className="text-fg-muted text-[13px]">
                <Prose text={a.text} />
              </p>
            )
          )}
          <UpgradeList upgrades={e.upgrades} showRepo={false} className="text-[12px]" />
        </div>
      )}
    </div>
  );
}

function RepoSection({ title, entries }: { title: string; entries: RepoEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section className="border-line border-t pt-3 first:border-t-0 first:pt-0">
      <h4 className="type-label text-fg-muted mb-2.5">{caps(title)}</h4>
      <CollapsedList
        listClassName="grid gap-3"
        rows={entries.map((e) => ({ key: e.key, node: <RepoEntryRow entry={e} /> }))}
      />
    </section>
  );
}

function RepoGrid({ groups, t }: { groups: RepoGroup[]; t: Strings }) {
  if (groups.length === 0) {
    return <Card className="text-fg-muted px-[18px] py-5">No item names a repo this week.</Card>;
  }
  return (
    <div className="grid items-start gap-3 min-[768px]:grid-cols-2">
      {groups.map((g, i) => {
        const act = g.entries.filter((e) => e.section === "act");
        const know = g.entries.filter((e) => e.section === "know");
        return (
          <article
            key={g.repo ?? "_stack"}
            id={g.repo ? repoAnchor(g.repo) : undefined}
            style={{ "--i": Math.min(i, 10) } as CSSProperties}
            className={cn(
              "rise bg-surface ease-entrance rounded-card min-w-0 scroll-mt-24 border p-[15px] min-[560px]:p-[18px]",
              g.securityCount > 0 && "border-t-sec border-t-[3px]"
            )}
          >
            <header className="mb-3.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <TruncatedText as="b" className="max-w-full font-mono text-[15px] font-medium">
                {g.repo ?? "Whole stack"}
              </TruncatedText>
              <span className="text-fg-muted flex gap-3 text-[12.5px] tabular-nums">
                {act.length > 0 && (
                  <span className={cn(g.securityCount > 0 && "text-sec font-semibold")}>
                    {act.length} {act.length === 1 ? "needs" : "need"} attention
                  </span>
                )}
                {know.length > 0 && <span>{know.length} to know</span>}
              </span>
            </header>
            <div className="grid gap-3">
              <RepoSection title={t.act_title} entries={act} />
              <RepoSection title={t.know_title} entries={know} />
            </div>
          </article>
        );
      })}
    </div>
  );
}
