import { caps, strings, type Language } from "@/lib/i18n";
import {
  fixedFor,
  osvLink,
  severityLabel,
  splitTransitive,
  type AlertGroup,
  type TransitivePackageGroup,
} from "@/security/plan";

import {
  arrowLink,
  C,
  chip,
  DISPLAY,
  emailShell,
  esc,
  MONO,
  safeUrl,
  smallHeading,
  tag,
} from "./layout";
import type { RenderedEmail } from "./bulletin-email";

// Immediate emails: security alerts (one per org per security-scan run) and
// urgent triaged items (one per org per triage run).

/** Direct advisories past this many are listed one line each. */
export const ALERT_DETAIL_LIMIT = 25;

function subjectFor(prefix: string, first: string, more: number): string {
  const subject = `Briff · ${prefix}${first ? `: ${first}` : ""}${more > 0 ? ` +${more}` : ""}`;
  return subject.length > 160 ? `${subject.slice(0, 157)}...` : subject;
}

/** What a repo's first security scan found; one summary instead of one alert per advisory. */
export interface FirstScanSummary {
  repos: string[];
  /** Distinct advisories. */
  advisories: number;
  /** Of those, rated critical or high. */
  severe: number;
  /** Where the user sees them (the bulletins page). */
  url: string;
}

/**
 * The same-day security email: new critical/high advisories (direct dependencies first,
 * one block per advisory with its fix; transitive-only ones one block per package, no fix
 * command) and, when a repo was scanned for the first time, one calm summary of its backlog.
 */
export function renderSecurityAlertEmail(
  language: Language,
  groups: AlertGroup[],
  firstScan: FirstScanSummary | null = null,
  assetBaseUrl?: string
): RenderedEmail {
  const t = strings(language);
  const { direct, transitive } = splitTransitive(groups);
  const names = [...direct.map((g) => g.packageName), ...transitive.map((g) => g.packageName)];
  const subject =
    names.length > 0
      ? subjectFor(t.alert_subject, names[0], names.length - 1)
      : subjectFor(t.first_scan_subject(firstScan?.advisories ?? 0), "", 0);

  const repoText = (g: AlertGroup) =>
    g.repos
      .map((r) => `${r.name} (${r.installedVersion}${r.direct ? "" : `, ${t.transitive}`})`)
      .join(", ");
  const transitiveRepos = (g: TransitivePackageGroup) =>
    g.repos.map((r) => `${r.name} (${r.installedVersion})`).join(", ");
  const severityHtml = (severity: string | null) => tag(severityLabel(severity), "sec");
  const link = (href: string, text: string) =>
    `<a class="b-link" href="${esc(href)}" style="color:${C.link};text-decoration:none;">${esc(text)}</a>`;
  const meta = (label: string, value: string) =>
    `<div class="b-muted" style="font-size:13px;color:${C.muted};margin:6px 0 0;">${esc(label)}: <span class="b-text" style="color:${C.text};">${esc(value)}</span></div>`;

  const detailed = direct.slice(0, ALERT_DETAIL_LIMIT);
  const rest = direct.slice(ALERT_DETAIL_LIMIT);
  const blocks = detailed
    .map((g) => {
      const fixed = fixedFor(g);
      return `<div class="b-line" style="padding:16px 0;border-top:1px solid ${C.border};">
<div style="margin:0;"><span class="b-text" style="font-family:${MONO};font-size:15px;font-weight:500;color:${C.text};margin:0 8px 0 0;">${esc(g.packageName)}</span>${severityHtml(g.severity)}</div>
${g.summary ? `<div class="b-text" style="font-size:15px;line-height:1.5;color:${C.text};margin:8px 0 0;">${esc(g.summary.slice(0, 400))}</div>` : ""}
${meta(t.repos, repoText(g))}
${meta(t.fixed, fixed ?? t.no_fix)}
<div style="font-size:13px;margin:8px 0 0;font-family:${MONO};">${link(osvLink(g.osvId), g.osvId)}</div>
</div>`;
    })
    .join("\n");
  const restHtml =
    rest.length > 0
      ? `<div class="b-line b-muted" style="padding:14px 0 6px;border-top:1px solid ${C.border};font-size:13px;color:${C.muted};">${esc(t.alert_more(rest.length))}</div>
<ul class="b-text" style="padding-left:18px;margin:0;font-size:13px;line-height:1.6;color:${C.text};">${rest
          .map(
            (g) =>
              `<li>${link(osvLink(g.osvId), g.packageName)} · ${esc(severityLabel(g.severity))} · ${esc(g.repos.map((r) => r.name).join(", "))} · ${esc(fixedFor(g) ?? t.no_fix)}</li>`
          )
          .join("")}</ul>`
      : "";
  const transitiveHtml =
    transitive.length > 0
      ? `${smallHeading(t.alert_transitive_title)}
<div class="b-muted" style="font-size:13px;color:${C.muted};margin:0 0 8px;">${esc(t.alert_transitive_note)}</div>
${transitive
  .map(
    (g) => `<div class="b-line" style="padding:14px 0;border-top:1px solid ${C.border};">
<div style="margin:0;"><span class="b-text" style="font-family:${MONO};font-size:14px;font-weight:500;color:${C.text};margin:0 8px 0 0;">${esc(g.packageName)}</span>${tag(t.transitive, "wait")} ${severityHtml(g.severity)}${g.osvIds.length > 1 ? ` <span class="b-muted" style="font-size:12px;color:${C.muted};">· ${esc(t.advisories(g.osvIds.length))}</span>` : ""}</div>
${meta(t.repos, transitiveRepos(g))}
<div style="font-size:13px;margin:6px 0 0;font-family:${MONO};">${g.osvIds.map((id) => link(osvLink(id), id)).join(" · ")}</div>
</div>`
  )
  .join("\n")}`
      : "";
  const firstScanText = firstScan
    ? t.first_scan_intro(firstScan.repos.length, firstScan.advisories, firstScan.severe)
    : "";
  const firstScanHtml = firstScan
    ? `<div class="b-line" style="padding:16px 0 0;${names.length > 0 ? `border-top:1px solid ${C.border};margin:18px 0 0;` : ""}">
<p class="b-text" style="font-family:${names.length > 0 ? "inherit" : DISPLAY};font-size:${names.length > 0 ? "15px" : "19px"};line-height:1.4;margin:0 0 10px;font-weight:${names.length > 0 ? "500" : "600"};color:${C.text};">${esc(firstScanText)}</p>
<div style="margin:0 0 10px;line-height:1.6;">${firstScan.repos.map(chip).join(" ")}</div>
<p class="b-text" style="font-size:15px;line-height:1.5;color:${C.text};margin:0 0 12px;">${esc(t.first_scan_body)}</p>
<p style="font-size:14px;margin:0;">${arrowLink(safeUrl(firstScan.url), t.open)}</p>
</div>`
    : "";

  const html = emailShell({
    language,
    title: subject,
    footer: t.alert_footer,
    assetBaseUrl,
    body: `<div style="margin:0 0 10px;">${tag(t.section_security, "sec")}</div>
${names.length > 0 ? `<p class="b-text" style="font-family:${DISPLAY};font-size:21px;line-height:1.3;letter-spacing:-0.01em;margin:0 0 10px;font-weight:600;color:${C.text};">${esc(t.alert_intro(groups.length))}</p>` : ""}
${blocks}
${restHtml}
${transitiveHtml}
${firstScanHtml}`,
  });

  const text = [
    `Briff · ${t.section_security}`,
    "",
    ...(names.length > 0 ? [t.alert_intro(groups.length), ""] : []),
    ...detailed.flatMap((g) => [
      `* ${g.packageName} · ${severityLabel(g.severity)}`,
      ...(g.summary ? [`  ${g.summary.slice(0, 400)}`] : []),
      `  ${t.repos}: ${repoText(g)}`,
      `  ${t.fixed}: ${fixedFor(g) ?? t.no_fix}`,
      `  ${osvLink(g.osvId)}`,
      "",
    ]),
    ...(rest.length > 0
      ? [
          t.alert_more(rest.length),
          ...rest.map(
            (g) =>
              `- ${g.packageName} · ${severityLabel(g.severity)} · ${g.repos.map((r) => r.name).join(", ")} · ${fixedFor(g) ?? t.no_fix} · ${osvLink(g.osvId)}`
          ),
          "",
        ]
      : []),
    ...(transitive.length > 0
      ? [
          caps(t.alert_transitive_title),
          t.alert_transitive_note,
          "",
          ...transitive.flatMap((g) => [
            `* ${g.packageName} · ${t.transitive} · ${severityLabel(g.severity)}${g.osvIds.length > 1 ? ` · ${t.advisories(g.osvIds.length)}` : ""}`,
            `  ${t.repos}: ${transitiveRepos(g)}`,
            ...g.osvIds.map((id) => `  ${osvLink(id)}`),
            "",
          ]),
        ]
      : []),
    ...(firstScan
      ? [
          firstScanText,
          firstScan.repos.join(", "),
          t.first_scan_body,
          `${t.open}: ${firstScan.url}`,
          "",
        ]
      : []),
    "--",
    t.alert_footer,
  ].join("\n");

  return { subject, html, text };
}

/** Runtime facts of a deterministic runtime security item (src/pipeline/runtime-urgent.ts). */
export interface UrgentRuntime {
  /** Display name (`PHP`). */
  name: string;
  /** One entry per affected repo: what it declares (`php 8.3 (Dockerfile)`). */
  repos: { repo: string; runs: string[] }[];
  fixedVersions: string[];
  /** Pre-announced release time, already formatted (`21 Oct 2026, 14:00 UTC`). */
  scheduledFor: string | null;
  severity: string | null;
  cveIds: string[];
  action: string | null;
  /** One action per repo; replaces `action` when set (follow-ups). */
  repoActions?: string[];
  /** Matched repos with no action because they are not affected: `repo (24.22.1 in Dockerfile)`. */
  unaffected?: string[];
  /** Matched repos without a version of the runtime on record. */
  noVersion?: string[];
}

export interface UrgentItem {
  title: string;
  url: string;
  /** Only security reaches the urgent email (bulletin.md §13). */
  bucket: "security";
  reason: string;
  sourceName: string;
  affectedRepos: string[];
  /** Every item folded into this block (one incident), headline item first. */
  sources?: { label: string; url: string }[];
  runtime?: UrgentRuntime;
  /**
   * A follow-up of an item already emailed: `addition` lists only repos added since the
   * alert of `since` (in the fix form once fixed versions are known); `fix` says the
   * announced fixed releases are out.
   */
  followUp?: { kind: "addition"; since: string } | { kind: "fix" };
}

/** Sentences of a runtime block, shared by the HTML and text parts. */
function runtimeLines(
  language: Language,
  r: UrgentRuntime,
  followUp: UrgentItem["followUp"],
  affectedRepos: readonly string[]
): {
  facts: string | null;
  status: string | null;
  runs: string[];
  unaffected: string | null;
  fixed: string | null;
  actions: string[];
} {
  const t = strings(language);
  const facts = [r.severity ? severityLabel(r.severity) : null, ...r.cveIds]
    .filter(Boolean)
    .join(" · ");
  const hasFix = r.fixedVersions.length > 0;
  const fixOut = hasFix ? t.runtime_fix_out(r.name, r.fixedVersions.join(", ")) : null;
  const status =
    followUp?.kind === "fix" && fixOut
      ? fixOut
      : followUp?.kind === "addition"
        ? [t.runtime_also_affects(affectedRepos.join(", "), followUp.since), fixOut]
            .filter(Boolean)
            .join(" ")
        : !hasFix && r.scheduledFor
          ? t.runtime_announced(r.name, r.scheduledFor)
          : null;
  const repoActions =
    r.repoActions && r.repoActions.length > 0 ? r.repoActions : r.action ? [r.action] : [];
  return {
    facts: facts || null,
    status,
    runs: r.repos.map((p) => `${t.runtime_runs(p.repo, p.runs.join(", "))}.`),
    unaffected:
      r.unaffected && r.unaffected.length > 0
        ? t.runtime_not_affected(r.unaffected.join(", "))
        : null,
    // Follow-ups in the fix form say it in the status line.
    fixed: hasFix && !followUp ? `${t.fixed}: ${r.fixedVersions.join(", ")}` : null,
    actions: [
      ...repoActions,
      ...(r.noVersion ?? []).map((repo) => t.runtime_no_version(repo, r.name)),
    ].map((a) => `${t.todo}: ${a}`),
  };
}

function runtimeHtml(language: Language, i: UrgentItem, r: UrgentRuntime): string {
  const l = runtimeLines(language, r, i.followUp, i.affectedRepos);
  const line = (text: string, cls: string, style: string) =>
    `<div class="${cls}" style="font-size:13.5px;line-height:1.5;${style}margin:6px 0 0;">${esc(text)}</div>`;
  const actions =
    l.actions.length > 0
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.inset}" class="b-inset" style="margin:12px 0 0;background:${C.inset};border-radius:12px;"><tr><td class="b-inset b-text m-inset" bgcolor="${C.inset}" style="background:${C.inset};border-radius:12px;padding:10px 14px 12px;color:${C.text};">
${l.actions.map((a) => line(a, "b-text", `color:${C.text};font-weight:600;`)).join("\n")}
</td></tr></table>`
      : "";
  return [
    l.facts ? line(l.facts, "b-sec", `color:${C.danger};font-weight:600;`) : "",
    l.status
      ? `<div class="b-text" style="font-size:15px;line-height:1.5;color:${C.text};margin:8px 0 0;">${esc(l.status)}</div>`
      : "",
    ...l.runs.map((run) => line(run, "b-text", `color:${C.text};`)),
    l.unaffected ? line(l.unaffected, "b-muted", `color:${C.muted};`) : "",
    l.fixed ? line(l.fixed, "b-muted", `color:${C.muted};`) : "",
    actions,
  ]
    .filter(Boolean)
    .join("\n");
}

function runtimeText(language: Language, i: UrgentItem, r: UrgentRuntime): string[] {
  const l = runtimeLines(language, r, i.followUp, i.affectedRepos);
  return [l.facts, l.status, ...l.runs, l.unaffected, l.fixed, ...l.actions]
    .filter((v): v is string => Boolean(v))
    .map((v) => `  ${v}`);
}

export function renderUrgentEmail(
  language: Language,
  items: UrgentItem[],
  assetBaseUrl?: string
): RenderedEmail {
  const t = strings(language);
  const first = items[0]?.followUp;
  const prefix =
    first?.kind === "fix"
      ? t.urgent_subject_fix
      : first?.kind === "addition"
        ? t.urgent_subject_addition(items[0].affectedRepos.length)
        : t.urgent_subject;
  const subject = subjectFor(prefix, items[0]?.title ?? "", items.length - 1);

  const link = (href: string, text: string) =>
    `<a class="b-link" href="${esc(safeUrl(href))}" style="color:${C.link};text-decoration:none;">${esc(text)}</a>`;
  const blocks = items
    .map(
      (i) => `<div class="b-line" style="padding:16px 0;border-top:1px solid ${C.border};">
<div style="margin:0 0 8px;">${tag(t.bucket_security, "sec")}</div>
<div style="font-family:${DISPLAY};font-size:19px;line-height:1.3;font-weight:600;letter-spacing:-0.01em;"><a class="b-text" href="${esc(safeUrl(i.url))}" style="color:${C.text};text-decoration:none;">${esc(i.title)}</a></div>
${i.runtime ? runtimeHtml(language, i, i.runtime) : i.affectedRepos.length > 0 ? `<div class="b-muted" style="font-size:13px;color:${C.muted};margin:8px 0 0;">${esc(t.affected)}: ${esc(i.affectedRepos.join(", "))}</div>` : ""}
${
  i.sources && i.sources.length > 1
    ? `<div class="b-muted" style="font-size:13px;color:${C.muted};margin:10px 0 0;">${esc(t.sources)}: ${i.sources.map((s) => link(s.url, s.label)).join(" · ")}</div>`
    : `<div style="font-size:13px;margin:10px 0 0;">${link(i.url, `${t.source}: ${i.sourceName}`)}</div>`
}
</div>`
    )
    .join("\n");

  const html = emailShell({
    language,
    title: subject,
    footer: t.urgent_footer,
    assetBaseUrl,
    body: `<div style="margin:0 0 10px;">${tag(t.bucket_security, "sec")}</div>
<p class="b-text" style="font-family:${DISPLAY};font-size:21px;line-height:1.3;letter-spacing:-0.01em;margin:0 0 10px;font-weight:600;color:${C.text};">${esc(t.urgent_intro)}</p>
${blocks}`,
  });

  const text = [
    "Briff",
    "",
    t.urgent_intro,
    "",
    ...items.flatMap((i) => [
      `* [${t.bucket_security}] ${i.title}`,
      ...(i.runtime
        ? runtimeText(language, i, i.runtime)
        : i.affectedRepos.length > 0
          ? [`  ${t.affected}: ${i.affectedRepos.join(", ")}`]
          : []),
      i.sources && i.sources.length > 1
        ? `  ${t.sources}: ${i.sources.map((s) => `${s.label} <${s.url}>`).join(" · ")}`
        : `  ${t.source}: ${i.url}`,
      "",
    ]),
    "--",
    t.urgent_footer,
  ].join("\n");

  return { subject, html, text };
}

export function renderTestEmail(language: Language, assetBaseUrl?: string): RenderedEmail {
  const t = strings(language);
  return {
    subject: t.test_subject,
    html: emailShell({
      language,
      title: t.test_subject,
      footer: t.footer,
      assetBaseUrl,
      body: `<p class="b-text" style="font-family:${DISPLAY};font-size:19px;line-height:1.4;font-weight:600;color:${C.text};margin:0;">${esc(t.test_body)}</p>`,
    }),
    text: `${t.test_body}\n\n--\n${t.footer}`,
  };
}
