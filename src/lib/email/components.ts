import { C, DISPLAY, esc, MONO, safeUrl } from "./layout";

// Reusable pieces for short transactional emails (account, ops) inside `emailShell`.
// Same rules as layout.ts: inline colours plus `b-*` classes for the dark palette,
// `m-*` classes for the phone layout.

/** Display-font page headline. */
export function emailHeadline(text: string): string {
  return `<h1 class="b-text" style="font-family:${DISPLAY};font-size:24px;line-height:1.25;font-weight:600;letter-spacing:-0.02em;color:${C.text};margin:0 0 12px;">${esc(text)}</h1>`;
}

/** Body paragraph: 16px, which is also the phone minimum. */
export function emailParagraph(text: string): string {
  return `<p class="b-text m-body" style="font-size:16px;line-height:1.55;color:${C.text};margin:0 0 12px;">${esc(text)}</p>`;
}

/** Muted small print (expiry, hints). */
export function emailNote(text: string): string {
  return `<p class="b-muted" style="font-size:14px;line-height:1.5;color:${C.muted};margin:16px 0 0;">${esc(text)}</p>`;
}

/**
 * Bulletproof primary button: a table cell carries the petrol fill (Outlook ignores
 * padding and backgrounds on links), the link inside is the 44px hit area.
 */
export function primaryButton(href: string, label: string): string {
  const url = esc(safeUrl(href));
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 4px;border-collapse:separate;"><tr><td align="center" valign="middle" height="44" bgcolor="${C.brand}" class="b-btn" style="background:${C.brand};border-radius:10px;height:44px;mso-padding-alt:0 22px;"><a href="${url}" target="_blank" class="b-btn" style="display:inline-block;min-height:44px;line-height:44px;padding:0 22px;font-family:${DISPLAY};font-size:16px;font-weight:600;color:#ffffff;background:${C.brand};text-decoration:none;border-radius:10px;">${esc(label)}</a></td></tr></table>`;
}

/** The button's URL as plain text, for clients that block buttons or links. */
export function fallbackUrl(href: string): string {
  const url = safeUrl(href);
  return `<p class="b-muted" style="font-size:14px;line-height:1.5;color:${C.muted};margin:18px 0 6px;">If the button does not work, copy this link into your browser:</p>
<p class="b-inset b-text" style="font-family:${MONO};font-size:12.5px;line-height:1.5;color:${C.text};background:${C.inset};border:1px solid ${C.border};border-radius:9px;padding:9px 12px;margin:0;word-break:break-all;overflow-wrap:anywhere;">${esc(url)}</p>`;
}

/** "Why you got this" footer line naming the instance that sent it. */
export function instanceFooter(reason: string, instanceUrl: string | undefined): string {
  const origin = instanceUrl?.replace(/\/$/, "");
  return origin ? `${reason} Sent by the Briff instance at ${origin}.` : reason;
}
