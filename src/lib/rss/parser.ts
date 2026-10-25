import "server-only";

// Tiny RSS / Atom parser. Regex-based on purpose — adding a full XML parser
// dep buys nothing for the handful of fields we need, and a malformed item
// just gets skipped. Handles RSS 2.0 <item> and Atom <entry> shapes.

export interface ParsedRssItem {
  guid: string;
  title: string;
  link: string;
  publishedAt: string;
  author: string | null;
  categories: string[];
  /** First image URL found in standard media-extension tags. */
  thumbnail: string | null;
  /** Body text (RSS description / content:encoded, Atom content / summary), entity-decoded. */
  content: string | null;
}

export interface ParsedRssFeed {
  title: string | null;
  items: ParsedRssItem[];
}

const ITEM_BLOCK_RE = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
const ENTRY_BLOCK_RE = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
const CHANNEL_TITLE_RE =
  /<channel[^>]*>[\s\S]*?<title(?:\s[^>]*)?>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i;
const FEED_TITLE_RE =
  /<feed[^>]*>[\s\S]*?<title(?:\s[^>]*)?>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i;
const CATEGORY_RE =
  /<category(?:\s[^>]*?term="([^"]+)"[^>]*)?(?:[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/category>)?/gi;
// Attribute values may be single-quoted (Blogger feeds), so links accept either quote.
const ATOM_LINK_HREF_RE = /<link\b[^>]*\bhref=["']([^"']+)["']/i;
// Atom entries can carry several <link>s (self, alternate, replies …). The
// canonical destination is rel="alternate"; prefer it, in either attr order.
const ATOM_LINK_ALTERNATE_RE = /<link\b[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["']/i;
const ATOM_LINK_ALTERNATE_RE_REVERSED =
  /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']alternate["']/i;
const ATOM_AUTHOR_BLOCK_RE = /<author\b[^>]*>([\s\S]*?)<\/author>/i;
// Image-bearing tags found across RSS / Atom / media extensions, in priority
// order. `<enclosure type="image/...">`, `<media:thumbnail url="...">`,
// `<media:content medium="image">`, then a fallback to any <img> inside the
// description block.
const ENCLOSURE_IMG_RE = /<enclosure\b[^>]*\burl="([^"]+)"[^>]*\btype="image\/[^"]*"[^>]*\/?>/i;
const ENCLOSURE_IMG_RE_REVERSED =
  /<enclosure\b[^>]*\btype="image\/[^"]*"[^>]*\burl="([^"]+)"[^>]*\/?>/i;
const MEDIA_THUMB_RE = /<media:thumbnail\b[^>]*\burl="([^"]+)"/i;
const MEDIA_CONTENT_IMG_RE = /<media:content\b[^>]*\burl="([^"]+)"[^>]*\bmedium="image"[^>]*\/?>/i;
const MEDIA_CONTENT_IMG_RE_REVERSED =
  /<media:content\b[^>]*\bmedium="image"[^>]*\burl="([^"]+)"[^>]*\/?>/i;
const IMG_SRC_RE = /<img\b[^>]*\bsrc="([^"]+)"/i;

function pickTag(block: string, tag: string): string | null {
  const re = new RegExp(
    `<${tag}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`,
    "i"
  );
  const m = block.match(re);
  return m ? decodeEntities(m[1].trim()) : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&hellip;/g, "…")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–");
}

// A feed item's link is rendered as an <a href>, so only http(s) may survive
// the parser — `javascript:` / `data:` links must never reach the UI.
function isSafeHttpLink(raw: string): boolean {
  try {
    const p = new URL(raw).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
}

// Atom author is `<author><name>X</name><uri>…</uri></author>` — pull the name
// out so we don't smear the <uri> text into the byline.
function atomAuthorName(block: string): string | null {
  const authorBlock = block.match(ATOM_AUTHOR_BLOCK_RE)?.[1];
  if (!authorBlock) return null;
  return pickTag(authorBlock, "name");
}

function parseItemBlock(block: string): ParsedRssItem | null {
  const title = pickTag(block, "title");
  // RSS uses <link>...</link>; Atom uses <link href="..."/> (prefer alternate).
  let link = pickTag(block, "link");
  if (!link) {
    const m =
      block.match(ATOM_LINK_ALTERNATE_RE) ??
      block.match(ATOM_LINK_ALTERNATE_RE_REVERSED) ??
      block.match(ATOM_LINK_HREF_RE);
    if (m) link = m[1];
  }
  if (link && !isSafeHttpLink(link.trim())) return null;
  const guid = pickTag(block, "guid") ?? pickTag(block, "id") ?? link;
  const pubDate =
    pickTag(block, "pubDate") ?? pickTag(block, "published") ?? pickTag(block, "updated");
  const author =
    pickTag(block, "dc:creator") ??
    pickTag(block, "creator") ??
    atomAuthorName(block) ??
    pickTag(block, "author") ??
    null;
  if (!title || !link || !guid || !pubDate) return null;

  const categories: string[] = [];
  CATEGORY_RE.lastIndex = 0;
  let catMatch: RegExpExecArray | null;
  while ((catMatch = CATEGORY_RE.exec(block))) {
    const term = catMatch[1] ?? catMatch[2];
    if (term) categories.push(decodeEntities(term).trim().toLowerCase());
  }
  CATEGORY_RE.lastIndex = 0;

  // Image extraction is best-effort. Cheap-to-miss is fine; we never want a
  // thumbnail to be the reason an item doesn't render.
  let thumbnail: string | null = null;
  const enclosure = block.match(ENCLOSURE_IMG_RE) ?? block.match(ENCLOSURE_IMG_RE_REVERSED);
  if (enclosure) thumbnail = enclosure[1];
  if (!thumbnail) {
    const media = block.match(MEDIA_THUMB_RE);
    if (media) thumbnail = media[1];
  }
  if (!thumbnail) {
    const mediaContent =
      block.match(MEDIA_CONTENT_IMG_RE) ?? block.match(MEDIA_CONTENT_IMG_RE_REVERSED);
    if (mediaContent) thumbnail = mediaContent[1];
  }
  if (!thumbnail) {
    const description = pickTag(block, "description") ?? pickTag(block, "content:encoded");
    if (description) {
      const img = description.match(IMG_SRC_RE);
      if (img) thumbnail = img[1];
    }
  }

  const content =
    pickTag(block, "content:encoded") ??
    pickTag(block, "content") ??
    pickTag(block, "description") ??
    pickTag(block, "summary");

  return {
    guid: guid.trim(),
    title,
    link: link.trim(),
    publishedAt: pubDate.trim(),
    // Strip "name <email>" form down to just the name where present.
    author: author ? author.replace(/<[^>]+>/g, "").trim() || null : null,
    categories,
    thumbnail: thumbnail ? thumbnail.trim() : null,
    content: content || null,
  };
}

export function parseRss(xml: string): ParsedRssFeed {
  const items: ParsedRssItem[] = [];

  ITEM_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ITEM_BLOCK_RE.exec(xml))) {
    const parsed = parseItemBlock(match[1]);
    if (parsed) items.push(parsed);
  }
  ITEM_BLOCK_RE.lastIndex = 0;

  if (items.length === 0) {
    // Try Atom <entry> blocks if no RSS items were found.
    ENTRY_BLOCK_RE.lastIndex = 0;
    while ((match = ENTRY_BLOCK_RE.exec(xml))) {
      const parsed = parseItemBlock(match[1]);
      if (parsed) items.push(parsed);
    }
    ENTRY_BLOCK_RE.lastIndex = 0;
  }

  const channelTitle = xml.match(CHANNEL_TITLE_RE)?.[1] ?? null;
  const feedTitle = xml.match(FEED_TITLE_RE)?.[1] ?? null;
  const title = decodeEntities((channelTitle ?? feedTitle ?? "").trim()) || null;

  return { title, items };
}
