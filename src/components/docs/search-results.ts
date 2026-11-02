// Pure helpers of the docs search dialog (docs-search.tsx), kept apart so tests need no DOM.

/** One searchable section of a docs page, as /docs/search.json serves it. */
export interface SearchDoc {
  href: string;
  page: string;
  section: string;
  heading: string;
  text: string;
}

export interface ResultGroup {
  key: number;
  page: string;
  section: string;
  hits: SearchDoc[];
}

/** Hits grouped by page, pages in the order of their best hit, at most `perPage` each. */
export function groupResults(hits: SearchDoc[], perPage = 4): ResultGroup[] {
  const groups = new Map<string, ResultGroup>();
  for (const hit of hits) {
    let group = groups.get(hit.page);
    if (!group) {
      group = { key: groups.size, page: hit.page, section: hit.section, hits: [] };
      groups.set(hit.page, group);
    }
    if (group.hits.length < perPage) group.hits.push(hit);
  }
  return [...groups.values()];
}

/** About 140 characters of `text` around the first query word it contains. */
export function snippet(text: string, query: string, width = 140): string {
  const lower = text.toLowerCase();
  const at = query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => lower.indexOf(w))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)[0];
  if (at === undefined || text.length <= width) return text.slice(0, width);
  const start = Math.max(0, Math.min(at - 40, text.length - width));
  const cut = text.slice(start, start + width);
  return `${start > 0 ? "…" : ""}${cut}${start + width < text.length ? "…" : ""}`;
}
