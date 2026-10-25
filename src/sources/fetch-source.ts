import { sha256Hex } from "@/lib/crypto";
import { conditionalRequestHeaders, fetchRssFeed, USER_AGENT } from "@/lib/rss/fetcher";
import { safeFetch } from "@/lib/rss/safe-fetch";
import type { RuntimeItemMeta } from "@/lib/runtime-security";
import { htmlToText, parseDate } from "@/lib/text";

import { parseChangelogMarkdown } from "./changelog-md";
import { fetchAdvisories } from "./github-advisories";
import { repoSlugFromFeedUrl } from "./github-releases";

export interface SourceToFetch {
  kind: string;
  url: string;
  name: string;
  etag: string | null;
  lastModified: string | null;
  /** Runtime the source is about; names GitHub advisory titles ("PHP security advisory: ..."). */
  runtime?: string | null;
}

export interface CollectedItem {
  guid: string | null;
  title: string;
  url: string;
  publishedAt: Date | null;
  rawText: string;
  contentHash: string;
  /** Runtime security facts (GitHub advisories here, matched feed posts in collect). */
  metadata?: RuntimeItemMeta;
}

export type SourceFetchOutcome =
  | {
      status: "ok";
      items: CollectedItem[];
      etag: string | null;
      lastModified: string | null;
      httpStatus: number;
    }
  | { status: "not_modified"; httpStatus: 304 }
  | { status: "error"; httpStatus: number | null; error: string };

/** Dedupe key: the same announcement syndicated by two feeds is stored once. */
export function contentHash(url: string, title: string): string {
  return sha256Hex(`${url.trim()}\n${title.trim()}`);
}

/** Converts raw.githubusercontent.com/{o}/{r}/{ref}/{path} to its github.com blob page. */
export function changelogPageUrl(rawUrl: string): string {
  const m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(rawUrl);
  return m ? `https://github.com/${m[1]}/${m[2]}/blob/${m[3]}/${m[4]}` : rawUrl;
}

async function fetchChangelog(source: SourceToFetch): Promise<SourceFetchOutcome> {
  try {
    const res = await safeFetch(source.url, {
      timeoutMs: 15_000,
      maxBytes: 3_000_000,
      headers: {
        Accept: "text/markdown, text/plain, */*;q=0.5",
        "User-Agent": USER_AGENT,
        ...conditionalRequestHeaders(source),
      },
    });
    if (res.status === 304) return { status: "not_modified", httpStatus: 304 };
    if (res.status < 200 || res.status >= 300) {
      return { status: "error", httpStatus: res.status, error: `HTTP ${res.status}` };
    }
    const page = changelogPageUrl(source.url);
    const items = parseChangelogMarkdown(res.body).map((entry) => {
      const url = `${page}#${entry.anchor}`;
      const title = `${source.name} ${entry.version}`;
      return {
        guid: entry.version,
        title,
        url,
        publishedAt: null,
        rawText: entry.body.slice(0, 20_000),
        contentHash: contentHash(url, title),
      };
    });
    return {
      status: "ok",
      items,
      etag: res.etag,
      lastModified: res.lastModified,
      httpStatus: res.status,
    };
  } catch (err) {
    return {
      status: "error",
      httpStatus: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function fetchFeed(source: SourceToFetch): Promise<SourceFetchOutcome> {
  const result = await fetchRssFeed(source.url, source);
  if (result.status !== "ok") return result;
  // GitHub release titles are bare versions ("v16.4.1"); prefix the repo.
  const slug = repoSlugFromFeedUrl(source.url);
  const items = result.parsed.items.map((entry) => {
    const title =
      slug && !entry.title.toLowerCase().includes(slug.split("/")[1].toLowerCase())
        ? `${slug} ${entry.title}`
        : entry.title;
    return {
      guid: entry.guid,
      title,
      url: entry.link,
      publishedAt: parseDate(entry.publishedAt),
      rawText: htmlToText(entry.content),
      contentHash: contentHash(entry.link, title),
    };
  });
  return {
    status: "ok",
    items,
    etag: result.etag,
    lastModified: result.lastModified,
    httpStatus: result.httpStatus,
  };
}

export function fetchSource(source: SourceToFetch): Promise<SourceFetchOutcome> {
  if (source.kind === "changelog_md") return fetchChangelog(source);
  if (source.kind === "github_advisories") return fetchAdvisories(source);
  return fetchFeed(source);
}
