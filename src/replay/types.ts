import type { RuntimeItemMeta } from "@/lib/runtime-security";
import type { BulletinView } from "@/pipeline/bulletin-model";

// A replay scenario: the sources, the real dated items they carried, sample repos
// (file contents, scanned with the real scanner parsers), what happened in the world,
// and the hourly clock the worker would have run on. See src/replay/engine.ts.

export interface ReplaySource {
  name: string;
  kind: "rss" | "github_advisories";
  url: string;
  class: "security" | "releases" | "news";
  /** Runtime id (`php`, `node`), as `Source.runtime`. */
  runtime: string | null;
}

export interface ReplayItem {
  /** `ReplaySource.name`. */
  source: string;
  title: string;
  url: string;
  /** Text as collect-sources stores it (`Item.rawText`). */
  body: string;
  /** Date the feed gives (`Item.publishedAt`). */
  publishedAt: Date;
  /**
   * When the item could first be fetched; defaults to `publishedAt`. php.net dates its
   * release posts by the entry, not by when they went live.
   */
  visibleAt?: Date;
  /** Facts an adapter brings itself (GitHub advisories); feed posts get theirs extracted. */
  metadata?: RuntimeItemMeta;
  /** In-place edits of the post (Node.js turns the pre-announcement into the release post). */
  updates?: { at: Date; body: string }[];
}

export interface ReplayRepo {
  name: string;
  /** Path relative to the repo root -> content, e.g. `Dockerfile` -> `FROM php:8.3-fpm`. */
  files: Record<string, string>;
}

export interface SourceLink {
  label: string;
  url: string;
}

export interface WorldEvent {
  at: Date;
  /** Only the day is known; `at` orders the event within it. */
  dateOnly?: boolean;
  title: string;
  detail?: string;
  sources: SourceLink[];
}

export interface ReplayScenario {
  id: string;
  title: string;
  /** One paragraph for the page header. */
  summary: string;
  repos: ReplayRepo[];
  sources: ReplaySource[];
  items: ReplayItem[];
  world: WorldEvent[];
  /** Hourly collect-sources runs (the scheduler's `0 * * * *`). */
  clock: Date[];
  /** weekly-bulletin runs (Monday 04:00 UTC), one stream with every repo. */
  weekly?: { at: Date; stream: string }[];
}

export interface ReplayEmail {
  kind: "urgent" | "weekly";
  at: Date;
  subject: string;
  html: string;
  text: string;
  /** The earliest new fact the email carries (an item appearing, a post gaining its fix). */
  trigger: { at: Date; title: string } | null;
  /** Minutes from the trigger to the send; null for the weekly bulletin. */
  delayMinutes: number | null;
  /** Item titles in the email, in order. */
  items: string[];
  /** The email's "To do" lines (urgent) or act actions (weekly), as rendered. */
  todo: string[];
  /** The "Sources" lines of folded urgent blocks, as rendered; empty for the weekly bulletin. */
  sources: string[];
  /** The weekly bulletin's view (what the /b/<id> page renders); null for urgent emails. */
  view: BulletinView | null;
}

export interface ReplayEntry {
  at: Date;
  worldEvent?: WorldEvent;
  briffEmail?: ReplayEmail;
}

export interface ReplayResult {
  scenario: ReplayScenario;
  entries: ReplayEntry[];
  /** Matched items that would need the LLM triage (left out of the weekly bulletin here). */
  untriaged: string[];
}
