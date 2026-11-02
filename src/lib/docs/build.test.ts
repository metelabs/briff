import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DocsContent } from "@/components/docs/docs-content";
import { ToastProvider } from "@/components/ui/toast";
import { serverEnvSchema } from "@/lib/env";

import { DOCS_SOURCES } from "../../../next.config";

import { loadDocs } from "./build";
import { DOCS_PAGES } from "./nav";

const ROOT = path.resolve(__dirname, "../../..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

/** `*` within one path segment, like the tracing and .dockerignore globs we use. */
function matches(glob: string, file: string): boolean {
  const pattern = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${pattern}$`).test(file);
}

const navFiles = [...new Set(DOCS_PAGES.flatMap((p) => p.parts.map((part) => part.file)))];

describe("docs build", () => {
  it("has no broken links or sections", async () => {
    const docs = await loadDocs();
    expect(docs.problems).toEqual([]);
  });

  it("renders every page of the nav with a title and a body", async () => {
    const docs = await loadDocs();
    for (const navPage of DOCS_PAGES) {
      const page = docs.pages.get(navPage.slug);
      expect(page, navPage.slug).toBeDefined();
      if (!page) continue;
      expect(page.title.trim(), navPage.slug).not.toBe("");
      const html = renderToStaticMarkup(
        createElement(ToastProvider, null, createElement(DocsContent, { tree: page.hast }))
      );
      expect(html.replace(/<[^>]+>/g, "").trim().length, navPage.slug).toBeGreaterThan(40);
    }
  });

  it("documents every env variable in docs/CONFIGURATION.md", () => {
    const config = read("docs/CONFIGURATION.md");
    const keys = new Set(Object.keys(serverEnvSchema.shape));
    for (const file of [".env.example", ".env.selfhost.example"]) {
      for (const match of read(file).matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)) keys.add(match[1]);
    }
    const missing = [...keys].filter((key) => !config.includes(`\`${key}\``));
    expect(missing).toEqual([]);
  });

  it("ships every markdown file of the nav in the image", () => {
    const reincluded = read(".dockerignore")
      .split("\n")
      .filter((line) => line.startsWith("!"))
      .map((line) => line.slice(1));
    for (const file of navFiles) {
      expect(
        DOCS_SOURCES.some((glob) => matches(glob, file)),
        `${file} traced`
      ).toBe(true);
      const inImage = reincluded.some((glob) => matches(glob, file) || file.startsWith(`${glob}/`));
      expect(inImage, `${file} re-included in .dockerignore`).toBe(true);
    }
  });
});
