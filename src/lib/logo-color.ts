// Brand colours on the picker's tiles. A brand hex that would vanish on the tile background
// (Next.js black on the dark theme, TanStack cream on the light one) is replaced by the
// foreground colour of that theme (null = `currentColor`). Pure.

/** The tile backgrounds (`--surface-2` in src/app/globals.css). */
export const TILE_BACKGROUND = { light: "#f2f5f7", dark: "#0d161b" } as const;
/**
 * Below this contrast against the tile, a logo takes the foreground colour. Dark tiles need
 * more: a deep navy or purple mark reads on white but sinks into a near-black tile.
 */
export const MIN_LOGO_CONTRAST = { light: 1.4, dark: 1.8 } as const;

export interface LogoColors {
  /** `#rrggbb`, or null for the theme's foreground colour. */
  light: string | null;
  dark: string | null;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of `#rrggbb` or `rrggbb`. */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a hex colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function logoColors(hex: string): LogoColors {
  const colour = `#${hex.replace(/^#/, "").toLowerCase()}`;
  const keep = (theme: "light" | "dark") =>
    contrast(colour, TILE_BACKGROUND[theme]) >= MIN_LOGO_CONTRAST[theme];
  return { light: keep("light") ? colour : null, dark: keep("dark") ? colour : null };
}

/** Two letters for a tile without a logo: `Dokploy` → `Do`, `n8n` → `N8`. */
export function monogram(label: string): string {
  const letters = label.replace(/[^\p{L}\p{N}]/gu, "");
  return (letters.slice(0, 1).toLocaleUpperCase("en-US") + letters.slice(1, 2)).trim() || "?";
}

/** A stable hue (0–359) from the name, for the monogram tile's muted background. */
export function monogramHue(name: string): number {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + (ch.codePointAt(0) ?? 0)) % 360;
  return h;
}
