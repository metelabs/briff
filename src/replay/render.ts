import { esc, safeUrl } from "@/lib/email/layout";
import { runtimeVersionLabel } from "@/lib/runtime-range";

import { repoRuntimeRows } from "./engine";
import type { ReplayEmail, ReplayEntry, ReplayResult, ReplayScenario, WorldEvent } from "./types";

// Static, self-contained timeline page of a replay: left "What happened" (world events
// with their sources), right "What Briff sent" (the rendered email in a mail-like frame,
// with the send time and the delay from the fact that triggered it). Inline CSS, system
// fonts, light and dark through prefers-color-scheme, one column on phones. The emails are
// embedded unchanged through iframe srcdoc; a small inline script sizes each frame to
// its content (without it a frame scrolls).

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function dayLabel(d: Date): string {
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
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

function worldCard(e: WorldEvent): string {
  const when = worldTimeLabel(e);
  return `<article class="card world">
<p class="meta"><span class="tag tag-world">What happened</span><time datetime="${e.at.toISOString()}">${esc(when)}</time></p>
<h3>${esc(e.title)}</h3>
${e.detail ? `<p class="detail">${esc(e.detail)}</p>` : ""}
<p class="sources">${e.sources
    .map((s) => `<a href="${esc(safeUrl(s.url))}" rel="noopener">${esc(s.label)}</a>`)
    .join('<span aria-hidden="true"> · </span>')}</p>
</article>`;
}

function emailCard(m: ReplayEmail): string {
  const kind = emailKindLabel(m);
  const timing =
    m.trigger && m.delayMinutes !== null
      ? `<span class="delay">${esc(delayLabel(m.delayMinutes))}</span> after “${esc(m.trigger.title)}” appeared`
      : WEEKLY_TIMING;
  return `<article class="card briff">
<p class="meta"><span class="tag tag-briff">What Briff sent</span><time datetime="${m.at.toISOString()}">${esc(timeLabel(m.at))}</time></p>
<p class="timing">${esc(kind)} · ${timing}</p>
<div class="mail">
<div class="mail-head">
<div><span class="k">From</span> Briff</div>
<div><span class="k">Subject</span> <strong>${esc(m.subject)}</strong></div>
</div>
<iframe class="mail-frame" title="${esc(m.subject)}" loading="lazy" sandbox="allow-same-origin allow-popups" srcdoc="${esc(m.html)}"></iframe>
</div>
</article>`;
}

function entryRow(e: ReplayEntry): string {
  if (e.worldEvent) {
    return `<li class="row row-world">${worldCard(e.worldEvent)}</li>`;
  }
  if (e.briffEmail) {
    return `<li class="row row-briff">${emailCard(e.briffEmail)}</li>`;
  }
  return "";
}

function timeline(entries: readonly ReplayEntry[]): string {
  const days = new Map<string, ReplayEntry[]>();
  for (const e of entries) {
    const key = e.at.toISOString().slice(0, 10);
    days.set(key, [...(days.get(key) ?? []), e]);
  }
  return [...days.values()]
    .map(
      (list) => `<section class="day">
<h2 class="day-label">${esc(dayLabel(list[0].at))}</h2>
<ol class="rows">
${list.map(entryRow).join("\n")}
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

const STYLE = `
:root{color-scheme:light dark;--bg:#fafaf9;--fg:#1c1917;--muted:#57534e;--line:#e7e5e4;--card:#ffffff;--world:#0f766e;--world-bg:#f0fdfa;--briff:#b91c1c;--briff-bg:#fef2f2;--link:#1d4ed8;--code:#f5f5f4}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--fg:#e7e5e4;--muted:#a8a29e;--line:#292524;--card:#1c1917;--world:#5eead4;--world-bg:#042f2e;--briff:#fca5a5;--briff-bg:#450a0a;--link:#93c5fd;--code:#292524}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
a{color:var(--link)}
.wrap{max-width:1180px;margin:0 auto;padding:28px 16px 48px}
.kicker{font-size:13px;letter-spacing:.02em;color:var(--muted);margin:0 0 6px}
h1{font-size:28px;line-height:1.2;margin:0 0 10px}
.summary{max-width:760px;margin:0 0 18px;color:var(--fg)}
details.repos-box{border:1px solid var(--line);border-radius:10px;background:var(--card);padding:10px 14px;margin:0 0 28px;max-width:760px}
details.repos-box summary{cursor:pointer;font-weight:600}
.repos{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:10px}
.repos pre{margin:4px 0;padding:8px 10px;background:var(--code);border-radius:6px;font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
.runs{font-size:13px;color:var(--muted)}
.cols{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:24px;position:sticky;top:0;z-index:2;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 0;margin:0 0 8px}
.cols h2{font-size:13px;letter-spacing:.06em;margin:0}
.cols .c-world{color:var(--world)}.cols .c-briff{color:var(--briff)}
.day-label{font-size:15px;margin:26px 0 10px;padding:0 0 6px;border-bottom:1px dashed var(--line);color:var(--muted);font-weight:600}
.rows{list-style:none;margin:0;padding:0;display:grid;gap:14px}
.row{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:24px}
.row-world .card{grid-column:1}
.row-briff .card{grid-column:2}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;min-width:0}
.world{border-left:4px solid var(--world)}
.briff{border-left:4px solid var(--briff)}
.meta{display:flex;gap:10px;align-items:center;margin:0 0 6px;font-size:13px;color:var(--muted)}
.meta time{font-variant-numeric:tabular-nums;font-weight:600;color:var(--fg)}
.tag{display:none;font-size:11px;letter-spacing:.04em;font-weight:700;border-radius:4px;padding:1px 6px}
.tag-world{background:var(--world-bg);color:var(--world)}.tag-briff{background:var(--briff-bg);color:var(--briff)}
.card h3{font-size:16px;line-height:1.35;margin:0}
.detail{margin:6px 0 0;font-size:14px;color:var(--muted)}
.sources{margin:8px 0 0;font-size:13px}
.timing{margin:0 0 10px;font-size:14px}
.delay{font-weight:700;color:var(--briff)}
.mail{border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#fff}
.mail-head{font-size:13px;line-height:1.5;padding:8px 12px;background:#f5f5f4;color:#1c1917;border-bottom:1px solid #e7e5e4;word-break:break-word}
.mail-head .k{display:inline-block;min-width:4.2em;color:#78716c}
.mail-frame{display:block;width:100%;height:560px;border:0;background:#fff}
footer{margin:40px 0 0;padding:18px 0 0;border-top:1px solid var(--line);font-size:14px;color:var(--muted);max-width:760px}
footer pre{background:var(--code);color:var(--fg);padding:10px 12px;border-radius:6px;overflow-x:auto;font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
@media (max-width:760px){
.cols{display:none}
.row{grid-template-columns:minmax(0,1fr);gap:0}
.row-world .card,.row-briff .card{grid-column:1}
.tag{display:inline-block}
h1{font-size:23px}
.card{padding:12px}
}
`;

const SCRIPT = `
function fit(f){try{var d=f.contentDocument;if(d&&d.body){f.style.height=Math.max(d.documentElement.scrollHeight,d.body.scrollHeight)+2+"px";}}catch(e){}}
document.querySelectorAll("iframe.mail-frame").forEach(function(f){f.addEventListener("load",function(){fit(f);});fit(f);});
window.addEventListener("resize",function(){document.querySelectorAll("iframe.mail-frame").forEach(fit);});
`;

export function renderReplayPage(result: ReplayResult): string {
  const s = result.scenario;
  const emails = result.entries.filter((e) => e.briffEmail).length;
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
<header>
<p class="kicker">${esc(REPLAY_KICKER)}</p>
<h1>${esc(replayHeading(s))}</h1>
<p class="summary">${esc(s.summary)} ${esc(replayEmailsSentence(emails))}</p>
<details class="repos-box"><summary>Sample repos (${s.repos.length})</summary>
${reposBlock(result)}
</details>
</header>
<div class="cols" aria-hidden="true"><h2 class="c-world">WHAT HAPPENED</h2><h2 class="c-briff">WHAT BRIFF SENT</h2></div>
<main>
${timeline(result.entries)}
</main>
<footer>
<p>${REPLAY_METHOD}</p>
<p>Run it yourself:</p>
<pre>${esc(replayCommand(s.id))}</pre>
<p>Scenario: <code>src/replay/scenarios/${esc(s.id)}.ts</code> · engine: <code>src/replay/engine.ts</code></p>
</footer>
</div>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
