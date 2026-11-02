import "server-only";

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import GithubSlugger from "github-slugger";
import type { Element, ElementContent, Root as HastRoot } from "hast";
import type { Heading, Nodes, Paragraph, PhrasingContent, Root, RootContent } from "mdast";
import { toString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";

import { SOURCE_URL } from "@/components/landing/links";
import { caps } from "@/lib/i18n";
import { isPublicReplayId } from "@/replay/public-ids";

import { loadHighlight, type Highlight } from "./highlight";
import { DOCS_PAGES, docsHref, type DocsNavPage, type DocsPart } from "./nav";

// Builds the docs site from the repository's markdown once per process: the pages of
// docs/_nav.json with their headings (GitHub's slugs, so anchors match the files on GitHub),
// links rewritten to the page that holds their target (or to the file on GitHub), code
// highlighted, `> **Note**` / `> **Warning**` as callouts, plus the search index. Reads only
// files of this repository (shipped in the image), never env or the database.

const ROOT = process.cwd();

export interface TocEntry {
  id: string;
  text: string;
  depth: 2 | 3;
}

export interface SearchEntry {
  href: string;
  page: string;
  section: string;
  heading: string;
  text: string;
}

export interface DocsPage {
  slug: string;
  title: string;
  section: string;
  description: string;
  hast: HastRoot;
  toc: TocEntry[];
  /** Files the page is built from; the first is the one "Edit this page" opens. */
  files: string[];
  /** Newest commit date of those files (ISO), or null without git history. */
  lastUpdated: string | null;
}

export interface DocsBuild {
  pages: Map<string, DocsPage>;
  search: SearchEntry[];
  /** Broken relative links, missing sections: empty when the docs are consistent. */
  problems: string[];
}

interface ParsedFile {
  tree: Root;
  ids: Set<string>;
}

const parser = unified().use(remarkParse).use(remarkGfm);
const toHast = unified().use(remarkRehype);

const parsed = new Map<string, ParsedFile>();

function parseFile(file: string): ParsedFile {
  const cached = parsed.get(file);
  if (cached) return cached;
  const tree = parser.parse(readFileSync(path.join(ROOT, file), "utf8"));
  const slugger = new GithubSlugger();
  const ids = new Set<string>();
  visit(tree, "heading", (node) => {
    const id = slugger.slug(toString(node));
    node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id } };
    ids.add(id);
  });
  const result = { tree, ids };
  parsed.set(file, result);
  return result;
}

function headingId(node: Heading): string {
  return String(node.data?.hProperties?.id ?? "");
}

/** The part's nodes: H1 dropped, `##` sections picked, excluded headings cut with their body. */
function selectPart(part: DocsPart, problems: string[]): RootContent[] {
  const { tree } = parseFile(part.file);
  const blocks: { key: string; nodes: RootContent[] }[] = [{ key: "_intro", nodes: [] }];
  for (const node of structuredClone(tree.children)) {
    if (node.type === "heading" && node.depth === 1) continue;
    if (node.type === "heading" && node.depth === 2)
      blocks.push({ key: headingId(node), nodes: [node] });
    else blocks[blocks.length - 1].nodes.push(node);
  }
  for (const key of part.sections ?? []) {
    if (!blocks.some((b) => b.key === key)) problems.push(`${part.file}: no section "${key}"`);
  }
  const kept = part.sections ? blocks.filter((b) => part.sections?.includes(b.key)) : blocks;
  const nodes = kept.flatMap((b) => b.nodes);
  if (!part.exclude) return nodes;
  const exclude = new Set(part.exclude);
  const out: RootContent[] = [];
  let dropping: number | null = null;
  for (const node of nodes) {
    if (node.type === "heading") {
      if (dropping !== null && node.depth <= dropping) dropping = null;
      if (dropping === null && exclude.has(headingId(node))) {
        exclude.delete(headingId(node));
        dropping = node.depth;
        continue;
      }
    }
    if (dropping === null) out.push(node);
  }
  for (const id of exclude) problems.push(`${part.file}: no heading "${id}" to exclude`);
  return out;
}

/** A place on the docs site: a page and a heading id on it ("" = the top of the page). */
interface Target {
  slug: string;
  hash: string;
}

interface LinkIndex {
  /** `file#id` → where that heading is rendered. */
  anchors: Map<string, Target>;
  /** file → where its start is rendered. */
  files: Map<string, Target>;
}

function targetHref(target: Target, pageSlug: string): string {
  if (target.slug === pageSlug) return target.hash ? `#${target.hash}` : docsHref(target.slug);
  return target.hash ? `${docsHref(target.slug)}#${target.hash}` : docsHref(target.slug);
}

function rewriteUrl(
  url: string,
  file: string,
  pageSlug: string,
  index: LinkIndex,
  problems: string[]
): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//") || url.startsWith("/")) return url;
  const hashAt = url.indexOf("#");
  const rawPath = hashAt < 0 ? url : url.slice(0, hashAt);
  const anchor = hashAt < 0 ? "" : decodeURIComponent(url.slice(hashAt + 1));
  const target =
    rawPath === ""
      ? file
      : path.posix.normalize(path.posix.join(path.posix.dirname(file), rawPath)).replace(/\/$/, "");
  const where = `${file}: link "${url}"`;
  if (target.startsWith("..")) {
    problems.push(`${where} leaves the repository`);
    return url;
  }
  const absolute = path.join(ROOT, target);
  if (!existsSync(absolute)) {
    problems.push(`${where}: ${target} does not exist`);
    return url;
  }
  const replay = /^docs\/replay\/([^/]+)\.html$/.exec(target);
  if (replay && isPublicReplayId(replay[1])) return `/replay/${replay[1]}`;
  if (target.endsWith(".md")) {
    if (anchor) {
      const place = index.anchors.get(`${target}#${anchor}`);
      if (place) return targetHref(place, pageSlug);
      if (!parseFile(target).ids.has(anchor)) {
        problems.push(`${where}: no heading #${anchor} in ${target}`);
        return url;
      }
      return `${SOURCE_URL}/blob/main/${target}#${anchor}`;
    }
    const place = index.files.get(target);
    if (place) return targetHref(place, pageSlug);
  }
  const kind = statSync(absolute).isDirectory() ? "tree" : "blob";
  return `${SOURCE_URL}/${kind}/main/${target}${anchor ? `#${anchor}` : ""}`;
}

const CALLOUTS: Record<string, "note" | "warning"> = {
  note: "note",
  "[!note]": "note",
  warning: "warning",
  "[!warning]": "warning",
};

/** `> **Note** ...` and `> [!NOTE]` blockquotes become callouts with a label. */
function markCallouts(root: Root) {
  visit(root, "blockquote", (node) => {
    const first = node.children[0];
    if (first?.type !== "paragraph") return;
    const lead = first.children[0];
    const label =
      lead?.type === "strong"
        ? toString(lead).replace(/:$/, "")
        : lead?.type === "text"
          ? (/^\[![a-z]+\]/i.exec(lead.value)?.[0] ?? "")
          : "";
    const kind = CALLOUTS[label.toLowerCase()];
    if (!kind) return;
    const rest: PhrasingContent[] = first.children.slice(1);
    if (lead.type === "text") rest.unshift({ type: "text", value: lead.value.slice(label.length) });
    const head = rest[0];
    if (head?.type === "text") rest[0] = { ...head, value: head.value.replace(/^[\s:]+/, "") };
    if (rest[0]?.type === "text" && rest[0].value === "") rest.shift();
    first.children = rest;
    if (rest.length === 0) node.children.shift();
    const title: Paragraph = {
      type: "paragraph",
      data: { hProperties: { className: ["docs-callout-title"] } },
      children: [{ type: "text", value: caps(kind === "note" ? "Note" : "Warning") }],
    };
    node.children.unshift(title);
    node.data = {
      ...node.data,
      hName: "div",
      hProperties: { className: ["docs-callout", `docs-callout-${kind}`], role: "note" },
    };
  });
}

function hastText(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(hastText).join("");
  return "";
}

/** `<pre><code class="language-x">` → highlighted, with its label and raw text for Copy. */
function markCode(root: HastRoot, highlight: Highlight) {
  visit(root, "element", (node: Element) => {
    if (node.tagName !== "pre") return;
    const code = node.children.find(
      (c): c is Element => c.type === "element" && c.tagName === "code"
    );
    if (!code) return;
    const classes = Array.isArray(code.properties.className) ? code.properties.className : [];
    const lang = String(classes.find((c) => String(c).startsWith("language-")) ?? "").slice(9);
    const text = hastText(code).replace(/\n$/, "");
    const highlighted = lang ? highlight(text, lang) : null;
    if (highlighted) code.children = highlighted;
    code.properties = {};
    node.properties = { dataLanguage: lang || undefined, dataCode: text };
  });
}

function firstParagraph(nodes: RootContent[]): string {
  let text = "";
  visit({ type: "root", children: nodes } satisfies Root, "paragraph", (p) => {
    if (text) return false;
    text = toString(p).replace(/\s+/g, " ").trim();
  });
  if (text.length <= 160) return text;
  const cut = text.slice(0, 157);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

function searchEntries(page: DocsNavPage & { section: string }, nodes: RootContent[]) {
  const href = docsHref(page.slug);
  const out: SearchEntry[] = [];
  let heading = page.title;
  let id = "";
  let text: string[] = [];
  const flush = () => {
    if (text.length === 0 && id === "") return;
    out.push({
      href: id ? `${href}#${id}` : href,
      page: page.title,
      section: page.section,
      heading,
      text: text.join(" ").replace(/\s+/g, " ").trim().slice(0, 1200),
    });
  };
  for (const node of nodes) {
    if (node.type === "heading" && node.depth <= 3) {
      flush();
      heading = toString(node);
      id = headingId(node);
      text = [];
    } else if (node.type !== "code" && node.type !== "html") {
      text.push(toString(node));
    }
  }
  flush();
  return out;
}

function lastCommitDate(files: string[]): string | null {
  let newest: string | null = null;
  for (const file of files) {
    try {
      const date = execFileSync("git", ["log", "-1", "--format=%cI", "--", file], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      }).trim();
      if (date && (newest === null || Date.parse(date) > Date.parse(newest))) newest = date;
    } catch {
      return null; // no git or no history (the Docker image): show no date rather than a wrong one
    }
  }
  return newest;
}

async function build(): Promise<DocsBuild> {
  const problems: string[] = [];
  const highlight = await loadHighlight();

  const selected = DOCS_PAGES.map((page) => ({
    page,
    parts: page.parts.map((part) => ({ part, nodes: selectPart(part, problems) })),
  }));

  const index: LinkIndex = { anchors: new Map(), files: new Map() };
  for (const { page, parts } of selected) {
    parts.forEach(({ part, nodes }, i) => {
      // A page made of one `##` section of a file: the page title stands in for its heading.
      const lead = nodes[0];
      if (
        i === 0 &&
        part.sections?.length === 1 &&
        lead?.type === "heading" &&
        lead.depth === 2 &&
        headingId(lead) === part.sections[0]
      ) {
        nodes.shift();
        index.anchors.set(`${part.file}#${headingId(lead)}`, { slug: page.slug, hash: "" });
      }
      const firstHeading = nodes.find((n): n is Heading => n.type === "heading");
      for (const node of nodes) {
        if (node.type !== "heading") continue;
        const key = `${part.file}#${headingId(node)}`;
        if (!index.anchors.has(key))
          index.anchors.set(key, { slug: page.slug, hash: headingId(node) });
      }
      const start = { slug: page.slug, hash: i > 0 && firstHeading ? headingId(firstHeading) : "" };
      if ((!part.sections || part.sections.includes("_intro")) && !index.files.has(part.file)) {
        index.files.set(part.file, start);
      }
    });
  }
  for (const { page, parts } of selected) {
    for (const { part } of parts) {
      if (!index.files.has(part.file)) index.files.set(part.file, { slug: page.slug, hash: "" });
    }
  }

  const pages = new Map<string, DocsPage>();
  const search: SearchEntry[] = [];
  for (const { page, parts } of selected) {
    const children: RootContent[] = [];
    for (const { part, nodes } of parts) {
      const root: Root = { type: "root", children: nodes };
      visit(root, (node: Nodes) => {
        if (node.type === "link" || node.type === "definition") {
          node.url = rewriteUrl(node.url, part.file, page.slug, index, problems);
        }
      });
      children.push(...nodes);
    }
    const root: Root = { type: "root", children };
    markCallouts(root);
    const hast = toHast.runSync(root) as HastRoot;
    markCode(hast, highlight);

    const depth = page.tocDepth ?? 3;
    const toc: TocEntry[] = children.flatMap((n) =>
      n.type === "heading" && (n.depth === 2 || (n.depth === 3 && depth === 3))
        ? [{ id: headingId(n), text: toString(n), depth: n.depth as 2 | 3 }]
        : []
    );
    const files = [...new Set(page.parts.map((p) => p.file))];
    pages.set(page.slug, {
      slug: page.slug,
      title: page.title,
      section: page.section,
      description: page.description ?? firstParagraph(children),
      hast,
      toc,
      files,
      lastUpdated: lastCommitDate(files),
    });
    search.push(...searchEntries(page, children));
  }
  return { pages, search, problems };
}

let cached: Promise<DocsBuild> | null = null;

/** The docs, built on first use and kept for the life of the process (they ship with the image). */
export function loadDocs(): Promise<DocsBuild> {
  cached ??= build().catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}

export function editUrl(file: string): string {
  return `${SOURCE_URL}/edit/main/${file}`;
}
