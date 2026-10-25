import { caps } from "@/lib/i18n";

// Shared pieces of Briff's emails, in the Triage design language (docs/DESIGN.md): petrol
// for links and actions, coral for security only, near-white cards on a grey-blue page.
// Table layout with inline CSS (Gmail drops most <style>). Dark mode:
// - clients that honour prefers-color-scheme (Apple Mail, iOS Mail) get the <style> block's
//   dark palette through `b-*` / `t-*` classes that override the inline light colours;
// - Outlook.com marks the elements it recolours with `data-ogsc` (text) / `data-ogsb`
//   (backgrounds); the same palette is repeated under those selectors;
// - Gmail (apps, and web with a dark theme) ignores both and inverts colours itself. For it,
//   every table and cell carries an explicit `bgcolor` attribute and every text element an
//   inline `color`, no surface is pure #fff or #000 (those invert to harsh edges), and the
//   logo is a white-on-petrol tile with transparent corners that reads on any background.
// Phone width (mobileCss): the frame's padding shrinks and item cards flatten into stacked
// sections so text gets the width back; inline styles stay the desktop look.
// No web fonts are loaded: Bricolage Grotesque / Geist are named first and fall back to the
// system stack.

export function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function safeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : "#";
}

/**
 * Light tokens (DESIGN.md §3); dark values live in DARK below. `bg` is a near-white instead
 * of the app's #ffffff: Gmail's inversion turns pure white into pure black edges.
 */
export const C = {
  page: "#f2f5f7",
  bg: "#fbfcfd",
  inset: "#f2f5f7",
  border: "#dde4e9",
  text: "#0d1b24",
  muted: "#566874",
  link: "#0b6b67",
  brand: "#0b6b67",
  brandSoft: "#d9eeec",
  danger: "#b93522",
  dangerSoft: "#fde6e0",
  upgrade: "#8a560a",
  upgradeSoft: "#fbefd9",
  read: "#3659b8",
  readSoft: "#e3eafb",
  wait: "#5a6973",
  waitSoft: "#e8edf0",
  chip: "#f2f5f7",
};

// Single quotes only: these values sit inside double-quoted style attributes.
export const FONT =
  "Geist,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
export const DISPLAY =
  "'Bricolage Grotesque',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
export const MONO =
  "'Geist Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

/** One dark-palette rule: background and border colours, and the text colour. */
interface DarkRule {
  selector: string;
  bg?: string;
  border?: string;
  borderTop?: string;
  color?: string;
}

/** Dark tokens (DESIGN.md §3) per class the templates use. */
const DARK: readonly DarkRule[] = [
  { selector: ".b-page", bg: "#0a1115" },
  { selector: ".b-card", bg: "#111a20", border: "#21303a" },
  { selector: ".b-inset", bg: "#0d161b", border: "#21303a" },
  { selector: ".b-line", border: "#21303a" },
  { selector: ".b-text", color: "#e5edf1" },
  { selector: ".b-muted", color: "#8d9faa" },
  { selector: ".b-link", color: "#3ccfc2" },
  { selector: ".b-sec", color: "#ff7b64" },
  { selector: ".b-sec-top", borderTop: "#ff7b64" },
  { selector: ".b-up-top", borderTop: "#f1b85b" },
  { selector: ".t-sec", bg: "#3a1912", color: "#ff7b64" },
  { selector: ".t-upgrade", bg: "#32260f", color: "#f1b85b" },
  { selector: ".t-read", bg: "#192343", color: "#8eaaff" },
  { selector: ".t-wait", bg: "#1b252c", color: "#93a3ad" },
  { selector: ".t-brand", bg: "#0e2e2d", color: "#3ccfc2" },
];

function surfaceDecl(r: DarkRule): string {
  return [
    r.bg ? `background:${r.bg} !important` : "",
    r.border ? `border-color:${r.border} !important` : "",
    r.borderTop ? `border-top-color:${r.borderTop} !important` : "",
  ]
    .filter(Boolean)
    .join(";");
}

function colorDecl(r: DarkRule): string {
  return r.color ? `color:${r.color} !important` : "";
}

/**
 * The dark palette three times: under prefers-color-scheme, and for Outlook.com under
 * `[data-ogsb]` (backgrounds, borders) and `[data-ogsc]` (text), the attributes it puts on
 * the elements it recolours.
 */
export function darkCss(): string {
  const media = DARK.map((r) => {
    const decl = [surfaceDecl(r), colorDecl(r)].filter(Boolean).join(";");
    return `  ${r.selector}{${decl}}`;
  });
  const ogsb = DARK.filter((r) => surfaceDecl(r)).map(
    (r) => `[data-ogsb] ${r.selector}{${surfaceDecl(r)}}`
  );
  const ogsc = DARK.filter((r) => r.color).map((r) => `[data-ogsc] ${r.selector}{${colorDecl(r)}}`);
  return `
:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme: dark){
${media.join("\n")}
}
${ogsb.join("\n")}
${ogsc.join("\n")}`;
}

/** Viewport width at and below which the phone layout applies. */
export const MOBILE_MAX_WIDTH = 480;

/**
 * Phone layout, by `m-*` class: the page and frame paddings shrink, `m-flat` cards lose
 * their side and bottom borders, radius, margin and side padding and become sections under
 * their top rule (a hairline, or the 3px security / deadline colour), inset boxes keep 8px,
 * and `m-cmd` commands scroll sideways instead of breaking inside a token (the tables around
 * one are `m-fixed`; auto layout would widen to the unbroken line). Class selectors only, in
 * a <style> block of its own: Gmail drops a whole block over a rule it rejects, and this one
 * must survive next to the dark palette's attribute selectors. Clients that strip <style>
 * entirely keep the inline desktop layout.
 */
export function mobileCss(): string {
  return `
@media only screen and (max-width: ${MOBILE_MAX_WIDTH}px){
  .m-fixed{table-layout:fixed !important}
  .m-page{padding:16px 8px 32px !important}
  .m-frame{padding:18px 12px !important}
  .m-flat{border-left-width:0 !important;border-right-width:0 !important;border-bottom-width:0 !important;border-radius:0 !important;margin:0 !important}
  .m-flat-cell{padding:14px 0 16px !important;border-radius:0 !important}
  .m-inset{padding:8px !important}
  .m-cmd{padding:8px !important;white-space:pre !important;overflow-x:auto !important;word-break:normal !important;overflow-wrap:normal !important}
}`;
}

/**
 * Email header logo (docs/DESIGN.md §12): the lockup in white on a petrol tile with
 * transparent corners (88x40, the 20px lockup with its clear space), one image that reads
 * on light pages, dark-mode pages and Gmail's inverted ones alike; Gmail never inverts
 * images, so a dark-ink lockup would vanish there. Without a base URL (the replay harness
 * renders with no web app) the word is typeset live as the brand README allows.
 */
function headerLogo(assetBaseUrl: string | undefined): string {
  if (!assetBaseUrl) {
    return `<span class="b-text" style="font-family:Figtree,'Avenir Next',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:22px;font-weight:600;letter-spacing:-0.01em;color:${C.text};">briff</span>`;
  }
  const base = esc(assetBaseUrl.replace(/\/$/, ""));
  return `<img src="${base}/brand/lockup-email-tile.png" width="88" height="40" alt="Briff" style="display:block;border:0;outline:none;width:88px;height:40px;">`;
}

export function emailShell(args: {
  language: string;
  title: string;
  body: string;
  footer: string;
  /** Web app origin; the header logo image is served from <origin>/brand/. */
  assetBaseUrl?: string;
}): string {
  return `<!doctype html>
<html lang="${esc(args.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(args.title)}</title>
<style>${mobileCss()}</style>
<style>${darkCss()}</style>
</head>
<body class="b-page" bgcolor="${C.page}" style="margin:0;padding:0;background:${C.page};color:${C.text};font-family:${FONT};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" class="b-page m-fixed" style="background:${C.page};">
<tr><td align="center" bgcolor="${C.page}" class="b-page m-page" style="padding:24px 12px 40px;background:${C.page};color:${C.text};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" class="b-page m-fixed" style="max-width:600px;background:${C.page};">
<tr><td class="b-page" bgcolor="${C.page}" style="padding:2px 4px 18px;background:${C.page};">${headerLogo(args.assetBaseUrl)}</td></tr>
<tr><td class="b-card b-text m-frame" bgcolor="${C.bg}" style="background:${C.bg};border:1px solid ${C.border};border-radius:16px;padding:24px 22px;color:${C.text};">
${args.body}
</td></tr>
<tr><td class="b-page b-muted" bgcolor="${C.page}" style="padding:16px 6px 0;font-size:12px;line-height:1.5;background:${C.page};color:${C.muted};">${esc(args.footer)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Mono repo/package chip. */
export function chip(text: string): string {
  return `<span class="b-inset b-text" style="display:inline-block;background:${C.chip};border:1px solid ${C.border};border-radius:7px;padding:1px 7px;margin:0 2px 4px 0;font-family:${MONO};font-size:12px;color:${C.text};">${esc(text)}</span>`;
}

export type TagKind = "sec" | "upgrade" | "read" | "wait" | "brand";

const TAG_COLORS: Record<TagKind, [string, string]> = {
  sec: [C.dangerSoft, C.danger],
  upgrade: [C.upgradeSoft, C.upgrade],
  read: [C.readSoft, C.read],
  wait: [C.waitSoft, C.wait],
  brand: [C.brandSoft, C.brand],
};

/** Label: caps() text on its kind's soft tint (never CSS text-transform). */
export function tag(text: string, kind: TagKind): string {
  const [bg, fg] = TAG_COLORS[kind];
  return `<span class="t-${kind}" style="display:inline-block;background:${bg};color:${fg};border-radius:6px;padding:2px 8px;font-size:11px;line-height:1.4;font-weight:600;letter-spacing:.04em;">${esc(caps(text))}</span>`;
}

/** Display-font heading, optionally with a count. */
export function sectionHeading(text: string, count?: number): string {
  return `<h2 class="b-text" style="font-family:${DISPLAY};font-size:19px;line-height:1.25;font-weight:600;letter-spacing:-0.02em;color:${C.text};margin:28px 0 12px;">${esc(text)}${count === undefined ? "" : ` <span class="b-muted" style="font-family:${FONT};font-size:12px;font-weight:500;letter-spacing:0;color:${C.muted};border:1px solid ${C.border};border-radius:999px;padding:1px 8px;vertical-align:3px;">${count}</span>`}</h2>`;
}

/** Small muted caps heading for secondary groups. */
export function smallHeading(text: string): string {
  return `<div class="b-muted" style="font-size:12px;letter-spacing:.06em;font-weight:600;color:${C.muted};margin:24px 0 6px;">${esc(caps(text))}</div>`;
}

/** The inset "fix" box: an eyebrow, then a command (mono) or a sentence. */
export function fixBox(eyebrow: string, action: string, command: boolean, after = ""): string {
  const body = command
    ? `<div class="b-card b-text m-cmd" style="background:${C.bg};border:1px solid ${C.border};border-radius:9px;padding:9px 12px;font-family:${MONO};font-size:13px;line-height:1.45;color:${C.text};word-break:break-word;">${esc(action)}</div>`
    : `<div class="b-text" style="font-size:15px;line-height:1.5;font-weight:600;color:${C.text};">${esc(action)}</div>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.inset}" class="b-inset m-fixed" style="margin:14px 0 0;background:${C.inset};border-radius:12px;"><tr><td class="b-inset b-text m-inset" bgcolor="${C.inset}" style="background:${C.inset};border-radius:12px;padding:12px 14px;color:${C.text};">
<div class="b-link" style="font-size:11px;letter-spacing:.06em;font-weight:600;color:${C.brand};margin:0 0 8px;">${esc(caps(eyebrow))}</div>
${body}${after}
</td></tr></table>`;
}

/** Petrol text link with an arrow. */
export function arrowLink(href: string, text: string): string {
  return `<a class="b-link" href="${esc(href)}" style="color:${C.link};text-decoration:none;font-weight:600;">${esc(text)} &rarr;</a>`;
}
