// Theme preference: a cookie, so the server renders <html data-theme> and the first
// paint is already right. "system" leaves the attribute off and CSS follows the OS.

export const THEME_COOKIE = "briff-theme";
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export function parseTheme(value: string | undefined | null): Theme {
  return value === "light" || value === "dark" ? value : "system";
}

/** The `data-theme` attribute for a preference; undefined for "system". */
export function themeAttribute(theme: Theme): "light" | "dark" | undefined {
  return theme === "system" ? undefined : theme;
}
