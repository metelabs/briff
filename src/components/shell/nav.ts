// Top bar destinations, in order. The stream is a scope (picker), not a destination.
export const NAV = [
  { href: "/bulletins", label: "Bulletins" },
  { href: "/alerts", label: "Alerts" },
  { href: "/stack", label: "Stack" },
  { href: "/repos", label: "Repos" },
  { href: "/streams", label: "Streams" },
  { href: "/settings", label: "Settings" },
] as const;

export type NavHref = (typeof NAV)[number]["href"] | "/" | "/admin";

export function initialsOf(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length >= 2
      ? `${words[0][0]}${words.at(-1)?.[0] ?? ""}`
      : (words[0] ?? email).slice(0, 2);
  return letters.toLocaleUpperCase("en-US");
}
