import type { Language } from "@/lib/i18n";
import type { Ecosystem } from "@scan/ecosystems";

import type { Bucket } from "./buckets";
import type { Section, TodoKind } from "./bulletin";
import type { RepoUpgrade } from "./upgrades";

// What the email and the /b/<id> page render, and the pure helpers over it. No database:
// loadBulletinView (bulletin-view.ts) fills it through withOrg; the landing page's sample
// and the replay build it from the pipeline's own output.

export interface BulletinViewItem {
  itemId: string;
  bucket: Bucket;
  headline: string;
  line: string;
  /** act: command or step; know: short phrase after `todo`. Empty on older bulletins. */
  action: string;
  todo: TodoKind | null;
  title: string;
  url: string;
  sourceName: string;
  affectedRepos: string[];
  dueAt: Date | null;
  /**
   * Items folded into this one: older releases of the same package (`release`),
   * or blog posts on the same story as a security item.
   */
  folded: { title: string; url: string; release: boolean }[];
  /** Per repo: installed version(s) -> the version the action moves it to; empty when none. */
  upgrades: RepoUpgrade[];
}

/** One line per package: every advisory of the period for it, across the stream's repos. */
export interface BulletinViewAlert {
  packageName: string;
  /** The package's ecosystem when it is not npm (the per-repo commands follow it). */
  ecosystem?: Exclude<Ecosystem, "npm">;
  /** The most severe advisory's severity. */
  severity: string | null;
  /** Advisory ids, most severe first; the line links the first. */
  osvIds: string[];
  repos: string[];
  /** Per release line, e.g. `4.7.10` or `15.5.9 (budget) · 14.2.35 (tracker)`. */
  fixed: string | null;
  /** Installed versions are known but some release line has no fix on it (no major upgrades). */
  noLineFix: boolean;
  /**
   * No affected repo has the package as a direct dependency: labelled "transitive", listed
   * after the direct lines, and without a fix (the update belongs to whatever pulls it in).
   */
  transitive: boolean;
  /** One entry per affected repo: its affected installed versions and the fix for its line. */
  installs: RepoUpgrade[];
}

/** Advisories behind alert lines (a line can stand for several). */
export function advisoryCount(alerts: readonly Pick<BulletinViewAlert, "osvIds">[]): number {
  return alerts.reduce((n, a) => n + a.osvIds.length, 0);
}

/** Bulletin page lists this many alert lines, then a count of the advisories left. */
export const BULLETIN_ALERT_LIMIT = 15;

export interface BulletinView {
  id: string;
  orgId: string;
  weekLabel: string;
  /** Null for bulletins whose stream was deleted. */
  streamId: string | null;
  streamName: string | null;
  language: Language;
  subject: string;
  summary: string;
  minorCount: number;
  model: string;
  promptVersion: string;
  createdAt: Date;
  emailStatus: string;
  /** When the bulletin email went out; null until it was sent. */
  emailSentAt: Date | null;
  /** Admin preview (never emailed); `previewModel` is the model that was requested. */
  preview: boolean;
  previewModel: string | null;
  act: BulletinViewItem[];
  know: BulletinViewItem[];
  rest: BulletinViewItem[];
  /** New advisories of the period, one line per package. */
  alerts: BulletinViewAlert[];
  /** Advisories of the period from a repo's first scan; their own, secondary group. */
  backlogAlerts: BulletinViewAlert[];
}

/** Rows stored before synthesis-v2 have no section; security and deadlines read as "act". */
export function sectionOf(section: Section | null, bucket: Bucket): Section {
  if (section) return section;
  return bucket === "security" || bucket === "deadline" ? "act" : "know";
}

/** Everything the email does not list: rest items plus minor ones. */
export function restCount(view: Pick<BulletinView, "rest" | "minorCount">): number {
  return view.rest.length + view.minorCount;
}

export function allItems(view: Pick<BulletinView, "act" | "know" | "rest">): BulletinViewItem[] {
  return [...view.act, ...view.know, ...view.rest];
}
