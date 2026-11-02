import type { ElementContent } from "hast";
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

// Syntax highlighting for the docs' code blocks, on the server only: a fixed set of grammars
// (what the markdown uses) and both themes as CSS variables, so the page's theme picks the
// colours without a second render. Fences in other languages stay plain text with their label.

const ALIASES: Record<string, string> = {
  sh: "bash",
  shell: "bash",
  console: "bash",
  yml: "yaml",
  ts: "typescript",
  env: "ini",
  dotenv: "ini",
};

let highlighter: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [
      import("shiki/themes/github-light-default.mjs"),
      import("shiki/themes/github-dark-default.mjs"),
    ],
    langs: [
      import("shiki/langs/bash.mjs"),
      import("shiki/langs/yaml.mjs"),
      import("shiki/langs/json.mjs"),
      import("shiki/langs/css.mjs"),
      import("shiki/langs/markdown.mjs"),
      import("shiki/langs/typescript.mjs"),
      import("shiki/langs/dockerfile.mjs"),
      import("shiki/langs/ini.mjs"),
      import("shiki/langs/sql.mjs"),
      import("shiki/langs/diff.mjs"),
    ],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return highlighter;
}

export type Highlight = (code: string, lang: string) => ElementContent[] | null;

/** A highlighter for one build: the children of `<code>` for `code` in `lang`, or null. */
export async function loadHighlight(): Promise<Highlight> {
  const shiki = await getHighlighter();
  const loaded = new Set(shiki.getLoadedLanguages());
  return (code, lang) => {
    const name = ALIASES[lang] ?? lang;
    if (!loaded.has(name)) return null;
    const root = shiki.codeToHast(code, {
      lang: name,
      themes: { light: "github-light-default", dark: "github-dark-default" },
      defaultColor: false,
    });
    const pre = root.children[0];
    const inner = pre?.type === "element" ? pre.children[0] : undefined;
    return inner?.type === "element" ? inner.children : null;
  };
}
