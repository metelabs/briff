import { embeddedEmailCss, embeddedEmailHtml } from "@/lib/email/embed";
import { esc, safeUrl } from "@/lib/email/layout";
import { caps } from "@/lib/i18n";
import { runtimeVersionLabel } from "@/lib/runtime-range";

import { repoRuntimeRows } from "./engine";
import type { ReplayEmail, ReplayEntry, ReplayResult, ReplayScenario, WorldEvent } from "./types";

// Static, self-contained page of a replay (docs/replay/*.html), and the page model the app's
// /replay/<id> shares with it (src/components/replay): a hero (incident, one line, dates,
// counts), a sticky table of contents on desktop, the sample repos, a vertical timeline (time
// on the left, one card per world event or email on the right; each email folds open into its
// own branded layout, inline, no frame), and what each sample repo was told and when.
// Inline CSS in the Triage tokens (docs/DESIGN.md), system fonts, light and dark through
// prefers-color-scheme, one column on phones. No script.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function dayLabel(d: Date): string {
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "Tue 20 Oct", for places where the year is already given. */
export function shortDayLabel(d: Date): string {
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function timeLabel(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

/** "+28 min", "+1 h", "+2 h 5 min". */
export function delayLabel(minutes: number): string {
  if (minutes < 60) return `+${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `+${h} h` : `+${h} h ${m} min`;
}

/** A world event's time; some sources only give the day. */
export function worldTimeLabel(e: WorldEvent): string {
  return e.dateOnly ? "time not published" : timeLabel(e.at);
}

export function emailKindLabel(m: ReplayEmail): string {
  return m.kind === "urgent" ? "Urgent email" : "Weekly bulletin";
}

export const WORLD_LABEL = "What happened";

export const WEEKLY_TIMING = "scheduled run, Monday 04:00 UTC";

// Page copy shared with the app's /replay/<id> route (src/app/replay), so both say the same.
export const REPLAY_KICKER = "Replay · real items, sample repos, no LLM involved";

export function replayHeading(s: ReplayScenario): string {
  return `${s.title}: what Briff would have sent`;
}

export function replayEmailsSentence(emails: number): string {
  return `Below are the ${emails} email${emails === 1 ? "" : "s"} Briff would have sent, each rendered by the production template.`;
}

export const REPLAY_METHOD =
  "The items are the ones the sources published, with their dates, read by the same parsers and extractors Briff runs in production. The worker's hourly collect is replayed with a fake clock: an item is collected by the first run after it appeared, matched to the sample repos by runtime, and the urgent pass and the weekly assembly run unchanged. Urgent emails never use a model. In the weekly bulletin the model writes the headline and one line; here the item title stands in, and the action is the deterministic one in both cases.";

export function replayCommand(id: string): string {
  return `npm run replay -- ${id} --out docs/replay/${id}.html`;
}

/** The summary's first sentence (the hero's one line) and the rest. */
export function summaryParts(summary: string): { lead: string; rest: string } {
  const end = summary.indexOf(". ");
  if (end === -1) return { lead: summary, rest: "" };
  return { lead: summary.slice(0, end + 1), rest: summary.slice(end + 2).trim() };
}

/** "Sat 17 Oct – Mon 26 Oct 2026": the first and the last day of the timeline. */
export function replaySpan(result: ReplayResult): string {
  const first = result.entries[0]?.at;
  const last = result.entries.at(-1)?.at;
  if (!first || !last) return "";
  if (first.toISOString().slice(0, 10) === last.toISOString().slice(0, 10)) return dayLabel(first);
  const year = last.getUTCFullYear();
  const start = first.getUTCFullYear() === year ? shortDayLabel(first) : dayLabel(first);
  return `${start} – ${shortDayLabel(last)} ${year}`;
}

export function replayEmailList(result: ReplayResult): ReplayEmail[] {
  return result.entries.flatMap((e) => (e.briffEmail ? [e.briffEmail] : []));
}

/** The shortest delay from a fact to its urgent email; null without one. */
export function fastestUrgent(result: ReplayResult): number | null {
  const delays = replayEmailList(result).flatMap((m) =>
    m.kind === "urgent" && m.delayMinutes !== null ? [m.delayMinutes] : []
  );
  return delays.length === 0 ? null : Math.min(...delays);
}

/** The email's timing line: the delay after its trigger, or the weekly schedule. */
export function emailTiming(m: ReplayEmail): { delay: string; after: string } | null {
  if (!m.trigger || m.delayMinutes === null) return null;
  return { delay: delayLabel(m.delayMinutes), after: `after “${m.trigger.title}” appeared` };
}

/** The email's to-do lines one per step, without the "To do:" lead. */
export function todoSteps(m: Pick<ReplayEmail, "todo">): string[] {
  return m.todo.flatMap((line) => line.replace(/^To do:\s*/, "").split(" · "));
}

export interface ReplayDay {
  /** Anchor, `day-2026-10-20`. */
  id: string;
  label: string;
  entries: ReplayEntry[];
}

export function replayDays(result: ReplayResult): ReplayDay[] {
  const days = new Map<string, ReplayEntry[]>();
  for (const e of result.entries) {
    const key = e.at.toISOString().slice(0, 10);
    days.set(key, [...(days.get(key) ?? []), e]);
  }
  return [...days].map(([key, entries]) => ({
    id: `day-${key}`,
    label: dayLabel(entries[0].at),
    entries,
  }));
}

/** Each sample repo: its files as `path: content` lines and what the scanner made of them. */
export function sampleRepos(result: ReplayResult): { name: string; files: string; runs: string }[] {
  const rows = repoRuntimeRows(result.scenario.repos);
  return result.scenario.repos.map((r) => ({
    name: r.name,
    files: Object.entries(r.files)
      .map(([path, content]) => `${path}: ${content.trim()}`)
      .join("\n"),
    runs: rows
      .filter((row) => row.repo === r.name)
      .map((row) => `${row.name} ${runtimeVersionLabel(row)} (${row.source})`)
      .join(", "),
  }));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The steps of an email that concern `repo`: its own (`repo: step`) or a step naming it. */
export function stepsFor(repo: string, m: Pick<ReplayEmail, "todo">): string[] {
  const named = new RegExp(`(^|[\\s,(])${escapeRegExp(repo)}(?=$|[\\s,).;:])`);
  return todoSteps(m).flatMap((step) => {
    if (step.startsWith(`${repo}: `)) return [step.slice(repo.length + 2)];
    return named.test(step) ? [step] : [];
  });
}

export interface RepoOutcome {
  repo: string;
  runs: string;
  /** Per email, in send order: the steps it gave this repo (empty: not named). */
  told: string[][];
}

/** What each sample repo was told, by which email. */
export function repoOutcomes(result: ReplayResult): RepoOutcome[] {
  const emails = replayEmailList(result);
  return sampleRepos(result).map((r) => ({
    repo: r.name,
    runs: r.runs,
    told: emails.map((m) => stepsFor(r.name, m)),
  }));
}

export const OUTCOME_NONE = "Not named";

/** The sections the table of contents lists, in page order. */
export function tocSections(
  result: ReplayResult
): { id: string; label: string; sub?: ReplayDay[] }[] {
  return [
    { id: "overview", label: "Overview" },
    { id: "repos", label: "Sample repos" },
    { id: "timeline", label: "Timeline", sub: replayDays(result) },
    { id: "outcome", label: "What each repo was told" },
    { id: "method", label: "How this replay works" },
  ];
}

/** The email styles of an embedded email on the static page (light and dark by the OS). */
export const STATIC_EMAIL_CSS = embeddedEmailCss(".mail-body", [
  { media: "(prefers-color-scheme: dark)" },
]);

function worldCard(e: WorldEvent): string {
  return `<article class="ev-card">
<p class="ev-meta"><span class="tag tag-wait">${esc(caps(WORLD_LABEL))}</span></p>
<h4>${esc(e.title)}</h4>
${e.detail ? `<p class="detail">${esc(e.detail)}</p>` : ""}
<p class="sources">${e.sources
    .map((s) => `<a href="${esc(safeUrl(s.url))}" rel="noopener">${esc(s.label)}</a>`)
    .join('<span aria-hidden="true"> · </span>')}</p>
</article>`;
}

function emailCard(m: ReplayEmail): string {
  const timing = emailTiming(m);
  const steps = todoSteps(m);
  return `<details class="ev-card mail-card mail-${m.kind}">
<summary>
<p class="ev-meta"><span class="tag ${m.kind === "urgent" ? "tag-sec" : "tag-brand"}">${esc(caps(emailKindLabel(m)))}</span><span class="timing">${
    timing ? `<b class="delay">${esc(timing.delay)}</b> ${esc(timing.after)}` : esc(WEEKLY_TIMING)
  }</span></p>
<h4>${esc(m.subject)}</h4>
${
  steps.length > 0
    ? `<p class="todo-label">${esc(caps("To do"))}</p>
<ul class="todo">
${steps.map((s) => `<li>${esc(s)}</li>`).join("\n")}
</ul>`
    : ""
}
<span class="toggle"><span class="show">Show the email</span><span class="hide">Hide the email</span></span>
</summary>
<div class="mail">
<div class="mail-head">
<div><span class="k">From</span> Briff</div>
<div><span class="k">Subject</span> <strong>${esc(m.subject)}</strong></div>
</div>
<div class="mail-body">${embeddedEmailHtml(m.html)}</div>
</div>
</details>`;
}

function entryRow(e: ReplayEntry): string {
  if (e.worldEvent) {
    return `<li class="ev ev-world">
<div class="ev-time"><time datetime="${e.worldEvent.at.toISOString()}">${esc(worldTimeLabel(e.worldEvent))}</time></div>
<div class="ev-body">${worldCard(e.worldEvent)}</div>
</li>`;
  }
  if (e.briffEmail) {
    const m = e.briffEmail;
    return `<li class="ev ev-${m.kind}">
<div class="ev-time"><time datetime="${m.at.toISOString()}">${esc(timeLabel(m.at))}</time></div>
<div class="ev-body">${emailCard(m)}</div>
</li>`;
  }
  return "";
}

function timeline(result: ReplayResult): string {
  return replayDays(result)
    .map(
      (day) => `<section class="day" id="${day.id}">
<h3 class="day-label">${esc(day.label)}</h3>
<ol class="events">
${day.entries.map(entryRow).join("\n")}
</ol>
</section>`
    )
    .join("\n");
}

function reposBlock(result: ReplayResult): string {
  return `<ul class="repos">
${sampleRepos(result)
  .map(
    (r) =>
      `<li><strong>${esc(r.name)}</strong><pre>${esc(r.files)}</pre><span class="runs">Scanned: ${esc(r.runs)}</span></li>`
  )
  .join("\n")}
</ul>`;
}

function outcomeTable(result: ReplayResult): string {
  const emails = replayEmailList(result);
  const head = emails
    .map(
      (m) =>
        `<th scope="col"><span class="tag ${m.kind === "urgent" ? "tag-sec" : "tag-brand"}">${esc(caps(emailKindLabel(m)))}</span><span class="when">${esc(shortDayLabel(m.at))} · ${esc(timeLabel(m.at))}</span></th>`
    )
    .join("");
  const rows = repoOutcomes(result)
    .map(
      (o) =>
        `<tr><th scope="row"><strong>${esc(o.repo)}</strong><span class="runs">${esc(o.runs)}</span></th>${o.told
          .map((steps) =>
            steps.length === 0
              ? `<td class="none">${esc(OUTCOME_NONE)}</td>`
              : `<td><ul>${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></td>`
          )
          .join("")}</tr>`
    )
    .join("\n");
  return `<div class="table-wrap"><table class="outcome">
<thead><tr><th scope="col">Repo</th>${head}</tr></thead>
<tbody>
${rows}
</tbody>
</table></div>`;
}

function toc(result: ReplayResult): string {
  return `<nav class="toc" aria-label="On this page">
<p class="toc-title">${esc(caps("On this page"))}</p>
<ol>
${tocSections(result)
  .map(
    (s) =>
      `<li><a href="#${s.id}">${esc(s.label)}</a>${
        s.sub
          ? `<ol>${s.sub.map((d) => `<li><a href="#${d.id}">${esc(d.label)}</a></li>`).join("")}</ol>`
          : ""
      }</li>`
  )
  .join("\n")}
</ol>
</nav>`;
}

function stats(result: ReplayResult): string {
  const emails = replayEmailList(result);
  const fastest = fastestUrgent(result);
  const outcomes = repoOutcomes(result);
  const told = outcomes.filter((o) => o.told.some((s) => s.length > 0)).length;
  const tiles = [
    { value: String(emails.length), caption: emails.length === 1 ? "email sent" : "emails sent" },
    ...(fastest === null
      ? []
      : [
          {
            value: delayLabel(fastest),
            caption: "fastest urgent email after its trigger",
            sec: true,
          },
        ]),
    { value: `${told}/${outcomes.length}`, caption: "sample repos given a step" },
  ];
  return `<ul class="stats">
${tiles
  .map(
    (t) =>
      `<li><span class="num${"sec" in t ? " sec" : ""}">${esc(t.value)}</span><span class="cap">${esc(t.caption)}</span></li>`
  )
  .join("\n")}
</ul>`;
}

const STYLE = `
:root{color-scheme:light dark;--bg:#f2f5f7;--surface:#ffffff;--surface-2:#f2f5f7;--line:#dde4e9;--line-strong:#b9c5ce;--fg:#0d1b24;--muted:#566874;--subtle:#8a99a3;--brand:#0b6b67;--brand-soft:#d9eeec;--sec:#b93522;--sec-soft:#fde6e0;--wait:#5a6973;--wait-soft:#e8edf0;--shadow:rgb(13 27 36 / .07)}
@media (prefers-color-scheme:dark){:root{--bg:#0a1115;--surface:#111a20;--surface-2:#0d161b;--line:#21303a;--line-strong:#34495a;--fg:#e5edf1;--muted:#8d9faa;--subtle:#5d6f7a;--brand:#3ccfc2;--brand-soft:#0e2e2d;--sec:#ff7b64;--sec-soft:#3a1912;--wait:#93a3ad;--wait-soft:#1b252c;--shadow:rgb(0 0 0 / .35)}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 Geist,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
a{color:var(--brand);text-underline-offset:3px}
:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
.wrap{max-width:1200px;margin:0 auto;padding:40px max(16px,env(safe-area-inset-left)) 64px}
.display,h1,h2{font-family:"Bricolage Grotesque",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.kicker{font-size:13px;color:var(--muted);margin:0 0 10px}
h1{font-size:clamp(34px,5vw,56px);line-height:1;letter-spacing:-.035em;font-weight:600;margin:0 0 16px;max-width:22ch;text-wrap:balance}
.lead{font-size:18px;line-height:1.45;margin:0 0 10px;max-width:60ch}
.dates{font-size:13px;color:var(--muted);margin:0;font-variant-numeric:tabular-nums}
.stats{list-style:none;margin:24px 0 0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,200px));gap:8px}
.stats li{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px 16px;display:grid;gap:6px}
.stats .num{font-family:"Bricolage Grotesque",-apple-system,sans-serif;font-size:34px;line-height:1;font-weight:600;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.stats .num.sec{color:var(--sec)}
.stats .cap{font-size:12px;color:var(--muted)}
.layout{display:grid;grid-template-columns:minmax(0,1fr);gap:40px;margin-top:48px}
.toc{display:none}
@media (min-width:980px){
.layout{grid-template-columns:200px minmax(0,1fr)}
.toc{display:block;position:sticky;top:24px;align-self:start;font-size:13px}
}
.toc-title{font-size:11.5px;font-weight:600;letter-spacing:.04em;color:var(--muted);margin:0 0 10px}
.toc ol{list-style:none;margin:0;padding:0;display:grid;gap:2px}
.toc ol ol{margin:2px 0 4px 10px;padding-left:10px;border-left:1px solid var(--line)}
.toc a{display:block;padding:4px 8px;border-radius:8px;color:var(--muted);text-decoration:none}
.toc a:hover{color:var(--fg);background:var(--surface)}
main>section{margin:0 0 56px;scroll-margin-top:16px}
h2{font-size:19px;line-height:1.2;letter-spacing:-.02em;font-weight:600;margin:0 0 14px}
.prose{max-width:72ch;margin:0 0 10px;font-size:15px;line-height:1.6}
.muted{color:var(--muted)}
.repos{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.repos li{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:16px 18px;display:grid;gap:8px;align-content:start}
.repos strong,pre,code,.ev-time,.runs,.when{font-family:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.repos strong{font-size:13px;font-weight:500}
pre{margin:0;padding:8px 10px;background:var(--surface-2);border-radius:12px;font-size:12.5px;line-height:1.45;white-space:pre-wrap;word-break:break-word}
.runs{font-size:12px;color:var(--muted)}
.day{scroll-margin-top:16px}
.day-label{font-size:13px;font-weight:600;color:var(--muted);margin:28px 0 12px;font-variant-numeric:tabular-nums}
.day:first-child .day-label{margin-top:0}
.events{list-style:none;margin:0;padding:0}
.ev{display:grid;grid-template-columns:96px minmax(0,1fr)}
.ev-time{padding:16px 16px 0 0;text-align:right;font-size:12.5px;font-weight:500;font-variant-numeric:tabular-nums}
.ev-world .ev-time time{color:var(--muted)}
.ev-body{position:relative;border-left:2px solid var(--line);padding:0 0 14px 22px;min-width:0}
.ev-body::before{content:"";position:absolute;left:-7px;top:19px;width:12px;height:12px;border-radius:999px;background:var(--surface);border:2px solid var(--wait)}
.ev-urgent .ev-body::before{background:var(--sec);border-color:var(--sec)}
.ev-weekly .ev-body::before{background:var(--brand);border-color:var(--brand)}
.ev:last-child .ev-body{padding-bottom:0}
.ev-card{display:block;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:16px 18px;min-width:0}
.mail-urgent{border-top:3px solid var(--sec)}
.ev-meta{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;margin:0 0 8px;font-size:13px}
.tag{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;line-height:1;font-weight:600;letter-spacing:.04em;border-radius:6px;padding:4px 7px}
.tag::before{content:"";width:6px;height:6px;border-radius:999px;background:currentColor}
.tag-wait{background:var(--wait-soft);color:var(--wait)}
.tag-sec{background:var(--sec-soft);color:var(--sec)}
.tag-brand{background:var(--brand-soft);color:var(--brand)}
.timing{color:var(--muted)}
.delay{color:var(--sec);font-weight:600;font-variant-numeric:tabular-nums}
.ev-card h4{font-size:15px;line-height:1.35;font-weight:500;margin:0;text-wrap:balance}
.detail{margin:6px 0 0;font-size:13.5px;color:var(--muted);max-width:72ch}
.sources{margin:10px 0 0;font-size:12.5px}
.mail-card summary{list-style:none;cursor:pointer}
.mail-card summary::-webkit-details-marker{display:none}
.todo-label{margin:12px 0 4px;font-size:11.5px;font-weight:600;letter-spacing:.04em;color:var(--brand)}
.todo{margin:0;padding:10px 12px 10px 28px;background:var(--surface-2);border-radius:12px;font-size:13px;display:grid;gap:4px}
.toggle{display:inline-flex;align-items:center;gap:6px;margin-top:12px;font-size:13px;font-weight:500;color:var(--brand)}
.toggle::after{content:"";width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:translateY(-2px) rotate(45deg)}
.mail-card[open] .toggle::after{transform:translateY(1px) rotate(-135deg)}
.mail-card .hide,.mail-card[open] .show{display:none}
.mail-card[open] .hide{display:inline}
.mail-card summary:hover .toggle{text-decoration:underline}
.mail{margin-top:14px;border:1px solid var(--line);border-radius:12px;overflow:hidden}
.mail-head{font-size:13px;line-height:1.5;padding:9px 14px;background:var(--surface-2);border-bottom:1px solid var(--line);overflow-wrap:anywhere}
.mail-head .k{display:inline-block;min-width:4.4em;color:var(--muted)}
.mail-body{overflow-x:auto}
.table-wrap{background:var(--surface);border:1px solid var(--line);border-radius:16px;overflow-x:auto}
.outcome{border-collapse:collapse;table-layout:fixed;width:100%;min-width:720px;font-size:13px}
.outcome th,.outcome td{text-align:left;vertical-align:top;padding:12px 14px;border-top:1px solid var(--line)}
.outcome thead th{border-top:0;background:var(--surface-2);font-weight:500;color:var(--muted);display:table-cell}
.outcome thead th .when{display:block;margin-top:6px;font-size:12px;font-variant-numeric:tabular-nums}
.outcome tbody th{position:sticky;left:0;background:var(--surface);min-width:170px;font-weight:400}
.outcome thead th:first-child{position:sticky;left:0;z-index:1;width:220px}
.outcome tbody th strong{display:block;font-family:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;font-weight:500}
.outcome ul{margin:0;padding-left:16px;display:grid;gap:4px}
.outcome .none{color:var(--subtle)}
.method pre{overflow-x:auto;white-space:pre}
footer{max-width:72ch}
@media (max-width:559px){
.wrap{padding-top:28px}
.lead{font-size:16px}
.stats{grid-template-columns:repeat(2,minmax(0,1fr))}
.ev{grid-template-columns:minmax(0,1fr)}
.ev-time{text-align:left;padding:0 0 6px 22px;border-left:2px solid var(--line)}
.ev-body::before{top:-21px}
.ev-card{padding:15px}
.events>.ev:first-child .ev-time{padding-top:0}
.outcome{min-width:600px}
.outcome thead th:first-child{width:150px}
.outcome tbody th{min-width:0}
}
${STATIC_EMAIL_CSS}
`;

export function renderReplayPage(result: ReplayResult): string {
  const s = result.scenario;
  const emails = replayEmailList(result).length;
  const { lead, rest } = summaryParts(s.summary);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(`Briff replay: ${s.title}`)}</title>
<meta name="description" content="${esc(`What Briff would have sent during ${s.title}: the real dated items, sample repos, the real email templates.`)}">
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
<header class="hero" id="top">
<p class="kicker">${esc(REPLAY_KICKER)}</p>
<h1>${esc(s.title)}</h1>
<p class="lead">${esc(lead)}</p>
<p class="dates">${esc(replaySpan(result))} · ${esc(String(s.world.length))} events · ${esc(String(s.repos.length))} sample repos</p>
${stats(result)}
</header>
<div class="layout">
${toc(result)}
<main>
<section id="overview">
<h2>What Briff would have sent</h2>
${rest ? `<p class="prose">${esc(rest)}</p>` : ""}
<p class="prose muted">${esc(replayEmailsSentence(emails))} Open an email card to read it as it arrived.</p>
</section>
<section id="repos">
<h2>Sample repos</h2>
${reposBlock(result)}
</section>
<section id="timeline">
<h2>Timeline</h2>
${timeline(result)}
</section>
<section id="outcome">
<h2>What each repo was told, and when</h2>
${outcomeTable(result)}
</section>
<section id="method" class="method">
<h2>How this replay works</h2>
<p class="prose">${esc(REPLAY_METHOD)}</p>
<p class="prose">Run it yourself:</p>
<pre>${esc(replayCommand(s.id))}</pre>
<p class="prose muted">Scenario: <code>src/replay/scenarios/${esc(s.id)}.ts</code> · engine: <code>src/replay/engine.ts</code></p>
</section>
</main>
</div>
</div>
</body>
</html>
`;
}
