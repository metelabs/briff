// Markdown changelogs served raw (e.g. Claude Code's CHANGELOG.md). Each
// "## <version>" heading becomes one entry. This parses a published Markdown
// file, not HTML; no scraping.

export interface ChangelogEntry {
  version: string;
  body: string;
  /** GitHub-style heading anchor ("2.1.300" -> "21300"). */
  anchor: string;
}

const HEADING_RE = /^##\s+(.+?)\s*$/;

export function githubAnchor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

export function parseChangelogMarkdown(markdown: string, limit = 30): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: { version: string; lines: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const body = current.lines.join("\n").trim();
    if (body)
      entries.push({ version: current.version, body, anchor: githubAnchor(current.version) });
  };

  for (const line of markdown.split(/\r?\n/)) {
    const heading = HEADING_RE.exec(line);
    if (heading) {
      flush();
      if (entries.length >= limit) return entries;
      current = { version: heading[1].replace(/^\[|\]$/g, ""), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  flush();
  return entries.slice(0, limit);
}
