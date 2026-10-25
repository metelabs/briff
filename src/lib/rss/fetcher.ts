import "server-only";

import { log } from "@/lib/log";

import { parseRss, type ParsedRssFeed, type ParsedRssItem } from "./parser";
import { safeFetch } from "./safe-fetch";
import { checkUrlSync } from "./ssrf-guard";

const FETCH_TIMEOUT_MS = 12000;
const MAX_BYTES = 2_000_000; // 2MB hard cap per feed body
const ALLOWED_CONTENT_TYPE_PREFIXES = [
  "application/rss+xml",
  "application/atom+xml",
  "application/xml",
  "text/xml",
  "text/html", // Some feeds mis-serve as text/html — accept and let parse decide.
];

export const USER_AGENT =
  process.env.BRIFF_RSS_USER_AGENT || "Mozilla/5.0 (compatible; Briff/1.0; +https://briff.dev)";

export interface ConditionalHeaders {
  etag?: string | null;
  lastModified?: string | null;
}

export type FeedFetchResult =
  | {
      status: "ok";
      parsed: ParsedRssFeed;
      etag: string | null;
      lastModified: string | null;
      httpStatus: number;
    }
  | { status: "not_modified"; httpStatus: 304 }
  | { status: "error"; httpStatus: number | null; error: string };

export function conditionalRequestHeaders(validators: ConditionalHeaders): Record<string, string> {
  const headers: Record<string, string> = {};
  if (validators.etag) headers["If-None-Match"] = validators.etag;
  if (validators.lastModified) headers["If-Modified-Since"] = validators.lastModified;
  return headers;
}

/**
 * SSRF-safe RSS/Atom fetch with conditional request support. Never throws;
 * callers record the outcome on the Source row.
 */
export async function fetchRssFeed(
  url: string,
  validators: ConditionalHeaders = {}
): Promise<FeedFetchResult> {
  const safety = checkUrlSync(url);
  if (!safety.ok) return { status: "error", httpStatus: null, error: `blocked: ${safety.reason}` };

  try {
    const res = await safeFetch(url, {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: MAX_BYTES,
      retries: 2,
      headers: {
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.5",
        "User-Agent": USER_AGENT,
        ...conditionalRequestHeaders(validators),
      },
    });
    if (res.status === 304) return { status: "not_modified", httpStatus: 304 };
    if (res.status < 200 || res.status >= 300) {
      log.warn({ url, status: res.status }, "rss:fetch: non-2xx");
      return { status: "error", httpStatus: res.status, error: `HTTP ${res.status}` };
    }
    if (!ALLOWED_CONTENT_TYPE_PREFIXES.some((p) => res.contentType.startsWith(p))) {
      log.warn({ url, contentType: res.contentType }, "rss:fetch: unsupported content-type");
      return { status: "error", httpStatus: res.status, error: `content-type ${res.contentType}` };
    }

    // An empty feed is valid (a repo without releases); callers decide whether
    // zero items is suspicious for that source.
    const parsed = parseRss(res.body);
    return {
      status: "ok",
      parsed,
      etag: res.etag,
      lastModified: res.lastModified,
      httpStatus: res.status,
    };
  } catch (err) {
    log.warn({ url, err }, "rss:fetch: failed");
    return {
      status: "error",
      httpStatus: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type { ParsedRssItem };
