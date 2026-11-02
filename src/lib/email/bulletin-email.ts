import { caps, strings, todoLabel, type Strings } from "@/lib/i18n";

import { isCommand } from "@/pipeline/bulletin";
import { upgradeLine } from "@/pipeline/upgrades";

import {
  arrowLink,
  C,
  chip,
  DISPLAY,
  emailShell,
  esc,
  fixBox,
  MONO,
  sectionHeading,
  smallHeading,
  tag,
  type TagKind,
} from "./layout";
import {
  advisoryCount,
  CONDENSED_NOTE,
  restCount,
  type BulletinView,
  type BulletinViewItem,
} from "@/pipeline/bulletin-model";

// Bulletin email: a capped to-do list (bulletin.md §13, §15). "Needs your
// attention" is one card per item with the action in a monospace block, "good to
// know" is compact rows, everything else is one line pointing at the web page.
// Feedback buttons live on the web page only. Table layout and inline CSS for
// Gmail. Labels are upper-cased in code (caps), never with CSS text-transform.

export interface EmailLinks {
  baseUrl: string;
  /** Signed token for this recipient (see lib/feedback-token.ts); opens the page without login. */
  token: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function bulletinUrl(baseUrl: string, bulletinId: string): string {
  return `${baseUrl.replace(/\/$/, "")}/b/${encodeURIComponent(bulletinId)}`;
}

/** Signed page link, optionally anchored at one item. */
export function bulletinPageUrl(links: EmailLinks, bulletinId: string, itemId?: string): string {
  const params = new URLSearchParams({ t: links.token });
  const anchor = itemId ? `#item-${encodeURIComponent(itemId)}` : "";
  return `${bulletinUrl(links.baseUrl, bulletinId)}?${params.toString()}${anchor}`;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function topClass(item: BulletinViewItem): string {
  if (item.bucket === "security") return `border-top:3px solid ${C.danger};`;
  if (item.bucket === "deadline") return `border-top:3px solid ${C.upgrade};`;
  return "";
}

function topBorderClass(item: BulletinViewItem): string {
  if (item.bucket === "security") return " b-sec-top";
  if (item.bucket === "deadline") return " b-up-top";
  return "";
}

function kicker(item: BulletinViewItem, t: Strings): string {
  const parts: string[] = [];
  if (item.bucket === "security") parts.push(t.section_security);
  if (item.dueAt) parts.push(`${t.due} ${formatDate(item.dueAt)}`);
  return parts.join(" · ");
}

/** "Also released: v1.2.0, v1.1.9 · Related: <blog post>", or empty. */
function alsoLine(item: BulletinViewItem, t: Strings): string {
  const released = item.folded.filter((f) => f.release).map((f) => f.title);
  const related = item.folded.filter((f) => !f.release).map((f) => f.title);
  return [
    released.length > 0 ? `${t.also_released}: ${released.join(", ")}` : "",
    related.length > 0 ? `${t.related}: ${related.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

// Commands get a monospace block; a sentence-style action reads better in the body font.
export { isCommand };

/** Installed -> recommended version per repo, muted under the action (upgrades.ts). */
function upgradesHtml(item: BulletinViewItem, margin: string): string {
  if (item.upgrades.length === 0) return "";
  const lines = item.upgrades
    .map((u) => `<div class="b-muted" style="color:${C.muted};">${esc(upgradeLine(u))}</div>`)
    .join("");
  return `<div style="margin:${margin};font-family:${MONO};font-size:12.5px;line-height:1.5;word-break:break-word;">${lines}</div>`;
}

function actCard(item: BulletinViewItem, t: Strings, detailsUrl: string): string {
  const top = kicker(item, t);
  const also = alsoLine(item, t);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" class="b-card m-flat m-fixed${topBorderClass(item)}" style="border-collapse:separate;margin:0 0 12px;background:${C.bg};border:1px solid ${C.border};${topClass(item)}border-radius:14px;">
<tr><td class="b-card b-text m-flat-cell" bgcolor="${C.bg}" style="padding:16px 16px 14px;background:${C.bg};color:${C.text};border-radius:14px;">
${top ? `<div style="margin:0 0 8px;">${tag(top, item.bucket === "security" ? "sec" : "upgrade")}</div>` : ""}
<div class="b-text" style="font-family:${DISPLAY};font-size:19px;line-height:1.25;font-weight:600;letter-spacing:-0.01em;color:${C.text};margin:0;">${esc(item.headline)}</div>
${item.line ? `<div class="b-muted" style="font-size:14px;line-height:1.5;color:${C.muted};margin:8px 0 0;">${esc(item.line)}</div>` : ""}
${item.affectedRepos.length > 0 ? `<div style="margin:10px 0 0;line-height:1.6;">${item.affectedRepos.map(chip).join(" ")}</div>` : ""}
${item.action ? fixBox(t.todo, item.action, isCommand(item.action), upgradesHtml(item, "8px 0 0")) : ""}
${also ? `<div class="b-muted" style="font-size:12.5px;color:${C.muted};margin:10px 0 0;">${esc(also)}</div>` : ""}
<div style="font-size:14px;margin:12px 0 0;">${arrowLink(detailsUrl, t.details)}</div>
</td></tr>
</table>`;
}

const TODO_KIND: Record<string, TagKind> = { upgrade: "upgrade", read: "read" };

function knowRow(
  item: BulletinViewItem,
  t: Strings,
  language: BulletinView["language"],
  detailsUrl: string
): string {
  const label = item.todo ? todoLabel(language, item.todo) : "";
  const note = [item.action, item.dueAt ? `${t.due} ${formatDate(item.dueAt)}` : ""]
    .filter(Boolean)
    .join(" · ");
  return `<tr><td class="b-card b-line b-text" bgcolor="${C.bg}" style="padding:12px 0;border-top:1px solid ${C.border};background:${C.bg};color:${C.text};">
${label ? `<div style="margin:0 0 6px;">${tag(label, (item.todo && TODO_KIND[item.todo]) || "wait")}</div>` : ""}
<div style="font-size:15px;line-height:1.4;margin:0;"><a class="b-text" href="${esc(detailsUrl)}" style="color:${C.text};text-decoration:none;font-weight:500;">${esc(item.headline)}</a></div>
${note ? `<div class="b-muted" style="font-size:13.5px;line-height:1.45;color:${C.muted};margin:4px 0 0;">${esc(note)}</div>` : ""}
${upgradesHtml(item, "4px 0 0")}
</td></tr>`;
}

/** "Briff · Work · Week 2026-W43"; bulletins without a stream leave the name out. */
export function kickerLine(
  view: Pick<BulletinView, "streamName" | "weekLabel">,
  t: Strings
): string {
  return ["Briff", view.streamName, t.week(view.weekLabel)].filter(Boolean).join(" · ");
}

export function renderBulletinEmail(view: BulletinView, links: EmailLinks): RenderedEmail {
  const t = strings(view.language);
  const pageUrl = bulletinPageUrl(links, view.id);
  const detailsUrl = (item: BulletinViewItem) => bulletinPageUrl(links, view.id, item.itemId);
  const rest = restCount(view);

  const actHtml = `${sectionHeading(t.act_title, view.act.length)}
${
  view.act.length > 0
    ? view.act.map((item) => actCard(item, t, detailsUrl(item))).join("\n")
    : `<p class="b-muted" style="font-size:15px;color:${C.muted};margin:0;">${esc(t.nothing_to_do)}</p>`
}`;

  const knowHtml =
    view.know.length > 0
      ? `${smallHeading(t.know_title)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" class="b-card" style="background:${C.bg};">
${view.know.map((item) => knowRow(item, t, view.language, detailsUrl(item))).join("\n")}
</table>`
      : "";

  const footerLines: string[] = [];
  if (rest > 0) footerLines.push(t.rest_line(view.rest.length, view.minorCount));
  // Alert lists hold one line per package; the sentences count the advisories behind them.
  // New ones are this week's news; a first scan's backlog gets its own calm line.
  if (view.alerts.length > 0) footerLines.push(t.alerts_line(advisoryCount(view.alerts)));
  if (view.backlogAlerts.length > 0)
    footerLines.push(t.backlog_line(advisoryCount(view.backlogAlerts)));
  if (view.baseImageAlerts?.length)
    footerLines.push(
      `${view.baseImageAlerts.length === 1 ? "1 base image" : `${view.baseImageAlerts.length} base images`} got distro fixes this week; rebuild on the latest tag. The bulletin page lists them.`
    );
  const restHtml =
    footerLines.length > 0
      ? `<p class="b-muted" style="font-size:14px;line-height:1.5;color:${C.muted};margin:28px 0 0;">${footerLines.map(esc).join(" ")} ${arrowLink(pageUrl, t.rest_link)}</p>`
      : `<p style="font-size:14px;margin:28px 0 0;">${arrowLink(pageUrl, t.open)}</p>`;

  const html = emailShell({
    language: view.language,
    title: view.subject,
    footer: t.footer,
    assetBaseUrl: links.baseUrl,
    body: `<div class="b-muted" style="font-size:13px;color:${C.muted};margin:0 0 8px;">${esc(kickerLine(view, t))}</div>
${view.summary ? `<p class="b-text" style="font-size:17px;line-height:1.5;margin:0;font-weight:500;color:${C.text};">${esc(view.summary)}</p>` : ""}${view.condensed ? `\n<p class="b-muted" style="font-size:13px;line-height:1.5;margin:10px 0 0;color:${C.muted};">${esc(CONDENSED_NOTE)}</p>` : ""}
${actHtml}
${knowHtml}
${restHtml}`,
  });

  const textParts: string[] = [kickerLine(view, t), ""];
  if (view.summary) textParts.push(view.summary, "");
  if (view.condensed) textParts.push(CONDENSED_NOTE, "");
  textParts.push(caps(t.act_title), "");
  if (view.act.length === 0) textParts.push(t.nothing_to_do, "");
  for (const item of view.act) {
    const top = kicker(item, t);
    textParts.push(`* ${top ? `[${top}] ` : ""}${item.headline}`);
    if (item.line) textParts.push(`  ${item.line}`);
    if (item.affectedRepos.length > 0)
      textParts.push(`  ${t.affected}: ${item.affectedRepos.join(", ")}`);
    if (item.action) textParts.push(`  > ${item.action}`);
    for (const u of item.upgrades) textParts.push(`    ${upgradeLine(u)}`);
    const also = alsoLine(item, t);
    if (also) textParts.push(`  ${also}`);
    textParts.push(`  ${t.details}: ${detailsUrl(item)}`, "");
  }
  if (view.know.length > 0) {
    textParts.push(caps(t.know_title), "");
    for (const item of view.know) {
      const label = item.todo ? `[${todoLabel(view.language, item.todo)}] ` : "";
      textParts.push(`* ${label}${item.headline}`);
      if (item.action) textParts.push(`  ${item.action}`);
      for (const u of item.upgrades) textParts.push(`  ${upgradeLine(u)}`);
      if (item.dueAt) textParts.push(`  ${t.due} ${formatDate(item.dueAt)}`);
      textParts.push(`  ${detailsUrl(item)}`);
    }
    textParts.push("");
  }
  if (footerLines.length > 0) textParts.push(footerLines.join(" "));
  textParts.push(`${rest > 0 ? t.rest_link : t.open}: ${pageUrl}`, "", "--", t.footer);

  return { subject: view.subject, html, text: textParts.join("\n") };
}
