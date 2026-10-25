import { USER_AGENT } from "@/lib/rss/fetcher";
import { safeFetch } from "@/lib/rss/safe-fetch";

// Some security feeds carry no body: the Node.js vulnerability feed has only title,
// link, guid and date. The post is published from Markdown in a public GitHub repo,
// so its body is read from there (raw Markdown, not the rendered HTML page), and the
// same file is re-read while the item is an open announcement: Node.js updates the
// post in place on release day (fixed versions, per-CVE affected lines).

const NODE_VULNERABILITY_POST =
  /^https:\/\/nodejs\.org\/en\/blog\/vulnerability\/([a-z0-9][a-z0-9-]*)\/?$/;

/** Raw Markdown URL behind a feed item's link; null when the source has no such mapping. */
export function postBodyUrl(itemUrl: string): string | null {
  const node = NODE_VULNERABILITY_POST.exec(itemUrl.trim());
  if (node) {
    return `https://raw.githubusercontent.com/nodejs/nodejs.org/main/apps/site/pages/en/blog/vulnerability/${node[1]}.md`;
  }
  return null;
}

/**
 * Plain text of a Markdown post: front matter dropped, heading marks, emphasis and
 * link targets removed, bullets kept as `- `.
 */
export function markdownToText(markdown: string): string {
  return markdown
    .replace(/^﻿/, "")
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<(https?:\/\/[^>]+)>/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*\*\s+/gm, "- ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type PostBodyFetcher = (url: string) => Promise<string | null>;

/** The post's text, or null when it could not be read (the item keeps its stored text). */
export const fetchPostBody: PostBodyFetcher = async (url) => {
  try {
    const res = await safeFetch(url, {
      timeoutMs: 15_000,
      maxBytes: 500_000,
      headers: { Accept: "text/markdown, text/plain, */*;q=0.5", "User-Agent": USER_AGENT },
    });
    if (res.status < 200 || res.status >= 300) return null;
    const text = markdownToText(res.body);
    return text.length > 0 ? text.slice(0, 20_000) : null;
  } catch {
    return null;
  }
};
