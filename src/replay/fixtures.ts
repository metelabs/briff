import { readFileSync } from "node:fs";
import path from "node:path";

import { parseRss } from "@/lib/rss/parser";
import { htmlToText, parseDate } from "@/lib/text";
import { advisoriesToItems, advisoryListSchema } from "@/sources/github-advisories";
import { markdownToText } from "@/sources/post-body";

import type { ReplayItem } from "./types";

// Real items for replay scenarios, read from the fixtures the source adapters are tested
// with (src/sources/__fixtures__) and turned into items by the same parsers collect-sources
// uses: the RSS/Atom parser plus htmlToText, the GitHub advisory adapter, and the Markdown
// reader of post bodies.

// Read from the working directory like the prompts (src/llm/prompts.ts): the repo root under
// Vitest and tsx, /app in the image, where next.config.ts traces these files into the
// standalone output for the /replay pages.
export const FIXTURE_DIR = path.join("src", "sources", "__fixtures__");

export function readFixture(name: string): string {
  return readFileSync(path.join(process.cwd(), FIXTURE_DIR, name), "utf8");
}

/** Feed entries as items (`rawText` = htmlToText of the entry content). */
export function feedItems(fixture: string, source: string): ReplayItem[] {
  return parseRss(readFixture(fixture)).items.flatMap((e) => {
    const publishedAt = parseDate(e.publishedAt);
    return publishedAt
      ? [{ source, title: e.title, url: e.link, body: htmlToText(e.content), publishedAt }]
      : [];
  });
}

/** GitHub security advisories through the real adapter (title, metadata, text). */
export function advisoryItems(fixture: string, source: string, runtime: string): ReplayItem[] {
  const list = advisoryListSchema.parse(JSON.parse(readFixture(fixture)));
  return advisoriesToItems(list, runtime).flatMap((i) =>
    i.publishedAt
      ? [
          {
            source,
            title: i.title,
            url: i.url,
            body: i.rawText,
            publishedAt: i.publishedAt,
            ...(i.metadata ? { metadata: i.metadata } : {}),
          },
        ]
      : []
  );
}

/** A post body as `fetchPostBody` returns it (Markdown source to plain text). */
export function postBody(fixture: string): string {
  return markdownToText(readFixture(fixture));
}

/** Hourly ticks from `from` to `to`, both included (UTC, on the hour). */
export function hourly(from: string, to: string): Date[] {
  const out: Date[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 3_600_000) out.push(new Date(t));
  return out;
}
