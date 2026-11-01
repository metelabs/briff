import { darkRules, mobileCss } from "./layout";

// An email shown inside a web page (the replays) instead of a mail client: its body as a
// <div>, and its <style> blocks rewritten under one scope class so they cannot touch the
// page. The page decides when the dark palette applies (prefers-color-scheme, a theme
// attribute), so it passes the conditions; the phone layout keeps the email's own breakpoint.

/** The email's <body> as a `<div>` with the body's class and inline style; the markup unchanged. */
export function embeddedEmailHtml(html: string): string {
  const match = /<body([^>]*)>([\s\S]*)<\/body>/i.exec(html);
  if (!match) return html;
  const attrs = match[1];
  const cls = /\sclass="([^"]*)"/.exec(attrs)?.[1] ?? "";
  const style = /\sstyle="([^"]*)"/.exec(attrs)?.[1] ?? "";
  return `<div class="${cls}" style="${style}">${match[2].trim()}</div>`;
}

/** When the dark palette applies: inside `media` (optional), under `prefix` (e.g. `[data-theme="dark"] `). */
export interface DarkCondition {
  media?: string;
  prefix?: string;
}

/** The email's phone layout and dark palette, every selector under `scope` (e.g. `.mail-body`). */
export function embeddedEmailCss(scope: string, dark: readonly DarkCondition[]): string {
  const blocks = dark.map(({ media, prefix = "" }) => {
    const rules = darkRules(`${prefix}${scope} `).join("\n");
    return media ? `@media ${media}{\n${rules}\n}` : rules;
  });
  return [mobileCss(`${scope} `), ...blocks].join("\n");
}
