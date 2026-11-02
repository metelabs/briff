import { z } from "zod";

import navJson from "../../../docs/_nav.json";

// The docs site's table of contents (docs/_nav.json): sections of pages, each page built from
// one or more repository markdown files, whole or by `##` section. Pure data, no fs, so the
// sidebar and the sitemap can read it without rendering anything.

const partSchema = z.object({
  /** Repository-relative path of a markdown file. */
  file: z.string().regex(/\.md$/),
  /** `##` heading slugs to keep (`_intro` = the text before the first one); default: all. */
  sections: z.array(z.string()).optional(),
  /** Heading slugs (any level) dropped with everything under them. */
  exclude: z.array(z.string()).optional(),
});

const pageSchema = z.object({
  /** URL below /docs; "" is the docs home. */
  slug: z.string().regex(/^([a-z0-9-]+(\/[a-z0-9-]+)*)?$/),
  title: z.string().min(1),
  parts: z.array(partSchema).min(1),
  /** Deepest heading level in "On this page" (default 3). */
  tocDepth: z.union([z.literal(2), z.literal(3)]).optional(),
});

const navSchema = z.object({
  sections: z.array(z.object({ title: z.string().min(1), pages: z.array(pageSchema).min(1) })),
});

export type DocsPart = z.infer<typeof partSchema>;
export type DocsNavPage = z.infer<typeof pageSchema>;
export interface DocsNavSection {
  title: string;
  pages: DocsNavPage[];
}

export const DOCS_BASE = "/docs";

export const DOCS_NAV: readonly DocsNavSection[] = navSchema.parse(navJson).sections;

export function docsHref(slug: string): string {
  return slug === "" ? DOCS_BASE : `${DOCS_BASE}/${slug}`;
}

/** Every page in sidebar order, with the section it belongs to. */
export const DOCS_PAGES: readonly (DocsNavPage & { section: string })[] = DOCS_NAV.flatMap((s) =>
  s.pages.map((p) => ({ ...p, section: s.title }))
);

export function findDocsPage(slug: string) {
  return DOCS_PAGES.find((p) => p.slug === slug) ?? null;
}

export function neighbours(slug: string) {
  const i = DOCS_PAGES.findIndex((p) => p.slug === slug);
  return {
    prev: i > 0 ? DOCS_PAGES[i - 1] : null,
    next: i >= 0 && i < DOCS_PAGES.length - 1 ? DOCS_PAGES[i + 1] : null,
  };
}

/** The sidebar's view of the nav: titles and links only (sent to the client). */
export interface DocsNavLink {
  href: string;
  title: string;
}
export function navLinks(): { title: string; links: DocsNavLink[] }[] {
  return DOCS_NAV.map((s) => ({
    title: s.title,
    links: s.pages.map((p) => ({ href: docsHref(p.slug), title: p.title })),
  }));
}
