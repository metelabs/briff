import semver from "semver";

import type { Strings } from "@/lib/i18n";
import { severityLabel } from "@/security/plan";

import { isCommand } from "./bulletin";
import type { BulletinView, BulletinViewAlert, BulletinViewItem } from "./bulletin-model";
import { NO_FIX_CLAUSE, releaseLine } from "./fixes";
import { installCommand } from "./install-commands";
import { upgradesFor, type RepoUpgrade } from "./upgrades";

// The bulletin's "By repo" pivot: the same items as "By item", regrouped per affected
// repo, with the part of each item's action that concerns that repo. Pure, so the page
// and its tests share it. Nothing here writes new advice: actions are only split out of
// the text the pipeline already derived (fixes.ts / runtime-fixes.ts).

export type RepoItemKind = "security" | "deadline" | "act" | "upgrade" | "read" | "wait";

export interface RepoAction {
  kind: "command" | "text";
  text: string;
  /** Derived for this repo alone (its upgrade line), so worth copying even as a sentence. */
  own?: true;
}

export interface RepoEntry {
  /** BulletinViewItem.itemId, or `alert:<package>` for an advisory line. */
  key: string;
  /** "Needs your attention" (act items and new advisories) or "Good to know". */
  section: "act" | "know";
  kind: RepoItemKind;
  title: string;
  actions: RepoAction[];
  /** What this repo has installed and the version the action moves it to. */
  upgrades: RepoUpgrade[];
}

export interface RepoGroup {
  /** Repo name; null for items that reach the whole stack (no affected repo listed). */
  repo: string | null;
  entries: RepoEntry[];
  securityCount: number;
}

function itemKind(item: BulletinViewItem, section: "act" | "know"): RepoItemKind {
  if (section === "act") {
    if (item.bucket === "security") return "security";
    if (item.bucket === "deadline") return "deadline";
    return "act";
  }
  if (item.todo === "upgrade" || item.todo === "read") return item.todo;
  return "wait";
}

function repoList(text: string): string[] {
  return text
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
}

/** `npm i x@1 (a, b)` -> command + repos; null when the clause names no repo list. */
const COMMAND_WITH_REPOS = /^(.*\S)\s+\((?!sha [a-f\d]{40}\)$)([^()]+)\)$/i;
/** `garden.example: rebuild to pick up PHP 8.3.36; ...` (runtime-fixes.ts repo clauses). */
const REPO_CLAUSE = /^([^\s:]+):\s+(.+)$/;
const TRANSITIVE_CLAUSE = /^transitive:\s+(.+)$/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Same rule as the bulletin's repo naming: full name or last path segment, as a word. */
function mentionsRepo(text: string, repo: string): boolean {
  const names = [...new Set([repo, repo.split("/").pop() ?? repo])].filter(Boolean);
  return names.some((name) =>
    new RegExp(`(?<![\\w./-])${escapeRegExp(name)}(?![\\w/-])`, "i").test(text)
  );
}

/**
 * The parts of an act action that apply to `repo`. Actions are " · "-joined clauses:
 * `npm i pkg@X (repos)` per release line, `transitive: repos`, `repo: sentence` per
 * runtime repo, or a shared sentence (runtime-fixes.ts: "Update Node.js in a, b as soon
 * as the fixed release is out"). A shared sentence goes to the repos it names, or, if it
 * names none, to every affected repo no other clause covers. An action with no
 * structured clause at all applies to every affected repo as a whole.
 */
export function actionsForRepo(
  action: string,
  repo: string,
  affectedRepos: readonly string[]
): RepoAction[] {
  const text = action.trim();
  if (!text) return [];
  const clauses = text.split(" · ").map((c) => c.trim());
  const affected = new Set(affectedRepos);
  const covered = new Set<string>();
  const shared: string[] = [];
  let structured = false;
  const own: { index: number; action: RepoAction }[] = [];
  clauses.forEach((clause, index) => {
    const transitive = TRANSITIVE_CLAUSE.exec(clause);
    if (transitive) {
      structured = true;
      for (const r of repoList(transitive[1])) covered.add(r);
      return;
    }
    const withRepos = COMMAND_WITH_REPOS.exec(clause);
    if (
      withRepos &&
      (isCommand(withRepos[1]) || repoList(withRepos[2]).every((r) => affected.has(r)))
    ) {
      structured = true;
      const repos = repoList(withRepos[2]);
      for (const r of repos) covered.add(r);
      if (repos.includes(repo))
        own.push({
          index,
          action: { kind: isCommand(withRepos[1]) ? "command" : "text", text: withRepos[1] },
        });
      return;
    }
    const perRepo = REPO_CLAUSE.exec(clause);
    if (perRepo && affected.has(perRepo[1])) {
      structured = true;
      covered.add(perRepo[1]);
      if (perRepo[1] === repo) own.push({ index, action: { kind: "text", text: perRepo[2] } });
      return;
    }
    shared.push(clause);
  });
  if (!structured) return [{ kind: isCommand(text) ? "command" : "text", text }];
  const sharedForRepo = shared.filter((clause) => {
    const named = affectedRepos.filter((r) => mentionsRepo(clause, r));
    return named.length > 0 ? named.includes(repo) : !covered.has(repo);
  });
  return [
    ...sharedForRepo.map((clause): RepoAction => ({
      kind: isCommand(clause) ? "command" : "text",
      text: clause,
    })),
    ...own.map((o) => o.action),
  ];
}

/**
 * A repo's own actions from its upgrade lines, which the pipeline derived from the same facts
 * as the item's action: the stored runtime sentence (`move Dockerfile to node:22.23.4-alpine`),
 * or the install command for a direct package with a target on its line. Transitive, unaffected
 * and target-less lines give none, and so does a runtime line stored before `action` existed.
 */
function sameReleaseLine(a: string, b: string): boolean {
  const va = semver.valid(a);
  const vb = semver.valid(b);
  return va !== null && vb !== null && releaseLine(va) === releaseLine(vb);
}

export function upgradeActions(upgrades: readonly RepoUpgrade[]): RepoAction[] {
  const out: RepoAction[] = [];
  // When one line of a package has the target on its own release line, the lines on other
  // release lines (another declaration, `==1.0.0` in a test group) are not what the action
  // moves: they get no command, so no edit crosses their major.
  const onLine = (u: RepoUpgrade) =>
    u.target !== null && u.installed.some((v) => sameReleaseLine(v, u.target as string));
  const anchored = new Set(upgrades.filter(onLine).map((u) => u.name));
  for (const u of upgrades) {
    let text: string | null = null;
    if (u.action) text = u.action;
    else if (anchored.has(u.name) && !onLine(u)) text = null;
    else if (!u.source && !u.transitive && !u.unaffected && u.target) {
      text = installCommand(u.ecosystem, u.name, u.target, {
        dev: u.dev,
        manager: u.manager,
        group: u.group,
        requirement: u.requirement,
        project: u.project,
        actionTags: u.actionTags,
      });
    }
    if (text && !out.some((a) => a.text === text)) {
      out.push({ kind: isCommand(text) ? "command" : "text", text, own: true });
    }
  }
  return out;
}

export interface RepoFixLine {
  upgrade: RepoUpgrade;
  /** This repo's own action, when the item's action does not already spell it out. */
  action: RepoAction | null;
}

/**
 * By item: the item's upgrade lines, each with the repo's own action when the item's action
 * is a summary that does not contain it ("Update Node.js to 22.23.4 in 12 repos (see the
 * advisory)."). An action that already lists every repo's step adds nothing per line.
 */
export function repoFixLines(item: Pick<BulletinViewItem, "action" | "upgrades">): RepoFixLine[] {
  const missing = (u: RepoUpgrade) => Boolean(u.action && !item.action.includes(u.action));
  const summarised = item.upgrades.some(missing);
  return item.upgrades.map((upgrade) => {
    const own = summarised && upgrade.action ? upgradeActions([upgrade])[0] : undefined;
    return { upgrade, action: own ?? null };
  });
}

export type ActionClause =
  { kind: "command"; command: string; repos: string[] } | { kind: "text"; text: string };

/**
 * An act action split for display: each " · " clause that is a command (optionally with
 * its repo list) gets its own copyable line; anything else stays one sentence.
 */
export function actionClauses(action: string): ActionClause[] {
  const text = action.trim();
  if (!text) return [];
  const clauses = text.split(" · ").map((c) => c.trim());
  const parsed = clauses.map((clause): ActionClause | null => {
    const withRepos = COMMAND_WITH_REPOS.exec(clause);
    if (withRepos && isCommand(withRepos[1])) {
      return { kind: "command", command: withRepos[1], repos: repoList(withRepos[2]) };
    }
    if (isCommand(clause)) return { kind: "command", command: clause, repos: [] };
    if (TRANSITIVE_CLAUSE.test(clause) || NO_FIX_CLAUSE.test(clause)) {
      return { kind: "text", text: clause };
    }
    return null;
  });
  if (parsed.some((p) => p?.kind === "command") && parsed.every((p) => p !== null)) {
    return parsed as ActionClause[];
  }
  return [{ kind: "text", text }];
}

function alertTitle(alert: BulletinViewAlert): string {
  const n = alert.osvIds.length;
  return `${alert.packageName}: ${n === 1 ? "1 new advisory" : `${n} new advisories`}, ${severityLabel(alert.severity).toLowerCase()}${alert.transitive ? " (transitive)" : ""}`;
}

/**
 * The alert line's fix text for one repo (bulletin-view.ts fixFor; no command is built
 * from it). Several release lines read `15.5.9 (a) · 14.2.35 (b)`: a repo gets only the
 * version for its own line, never another line's.
 */
export function alertActionsForRepo(
  alert: BulletinViewAlert,
  repo: string,
  t: Pick<Strings, "fixed" | "no_line_fix">
): RepoAction[] {
  if (alert.fixed) {
    if (!alert.fixed.includes("(")) return [{ kind: "text", text: `${t.fixed} ${alert.fixed}` }];
    for (const part of alert.fixed.split(" · ")) {
      const m = /^(\S+) \(([^()]+)\)$/.exec(part.trim());
      if (m && repoList(m[2]).includes(repo)) return [{ kind: "text", text: `${t.fixed} ${m[1]}` }];
    }
    return [];
  }
  if (alert.noLineFix) return [{ kind: "text", text: t.no_line_fix }];
  return [];
}

/**
 * Act and know items plus the period's new advisories, per affected repo. Repos are
 * ordered by security entries, then entry count, then name; items without repos form
 * one trailing group (`repo: null`). Folded ("rest") items stay folded.
 */
export function groupByRepo(
  view: Pick<BulletinView, "act" | "know" | "alerts">,
  t: Pick<Strings, "fixed" | "no_line_fix">
): RepoGroup[] {
  const groups = new Map<string | null, RepoEntry[]>();
  const add = (repo: string | null, entry: RepoEntry) => {
    const list = groups.get(repo) ?? [];
    if (!list.some((e) => e.key === entry.key)) list.push(entry);
    groups.set(repo, list);
  };
  for (const [section, items] of [
    ["act", view.act],
    ["know", view.know],
  ] as const) {
    for (const item of items) {
      const kind = itemKind(item, section);
      if (item.affectedRepos.length === 0) {
        add(null, {
          key: item.itemId,
          section,
          kind,
          title: item.headline,
          actions: item.action
            ? [{ kind: isCommand(item.action) ? "command" : "text", text: item.action }]
            : [],
          upgrades: [],
        });
        continue;
      }
      for (const repo of item.affectedRepos) {
        const upgrades = upgradesFor(item.upgrades, repo);
        // The repo's own step wins for act items: a summarised action names no repo's command.
        const own = upgradeActions(upgrades);
        // A repo listed without a target (no alert, no fix on its line) is not what the item's
        // command was derived for: `npm i payload@3.92.0` must not reach a repo on payload 2.
        const shared = actionsForRepo(item.action, repo, item.affectedRepos).filter(
          (a) => upgrades.length === 0 || a.kind !== "command"
        );
        add(repo, {
          key: item.itemId,
          section,
          kind,
          title: item.headline,
          actions:
            section === "act"
              ? own.length > 0
                ? own
                : shared
              : [
                  ...own,
                  ...(item.action && !own.some((a) => a.text === item.action)
                    ? [{ kind: "text" as const, text: item.action }]
                    : []),
                ],
          upgrades,
        });
      }
    }
  }
  for (const alert of view.alerts) {
    for (const repo of alert.repos) {
      const upgrades = upgradesFor(alert.installs, repo);
      const own = alert.transitive ? [] : upgradeActions(upgrades);
      add(repo, {
        key: `alert:${alert.packageName}`,
        section: "act",
        kind: "security",
        title: alertTitle(alert),
        actions: own.length > 0 ? own : alertActionsForRepo(alert, repo, t),
        upgrades,
      });
    }
  }
  return [...groups.entries()]
    .map(([repo, entries]) => ({
      repo,
      entries,
      securityCount: entries.filter((e) => e.kind === "security").length,
    }))
    .sort(
      (a, b) =>
        Number(a.repo === null) - Number(b.repo === null) ||
        b.securityCount - a.securityCount ||
        b.entries.length - a.entries.length ||
        (a.repo ?? "").localeCompare(b.repo ?? "")
    );
}

/**
 * DOM id of a repo's card in the By repo view. Reversible, so two repos never share an
 * id: letters, digits and `_` stay, every other code unit (including `-`) becomes
 * `-<hex>-` (`org/tool` -> `repo-org-2f-tool`, `org_tool` -> `repo-org_tool`).
 */
export function repoAnchor(repo: string): string {
  return `repo-${repo.replace(/[^A-Za-z0-9_]/g, (c) => `-${c.charCodeAt(0).toString(16)}-`)}`;
}
