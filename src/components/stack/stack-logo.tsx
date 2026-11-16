import type { CSSProperties } from "react";

import { monogram, monogramHue } from "@/lib/logo-color";
import { cn } from "@/lib/utils";

/** An icon as the server hands it to the picker (src/lib/stack-icons.ts). */
export interface LogoData {
  path: string;
  light: string | null;
  dark: string | null;
}

/**
 * A catalog item's logo in a fixed square: a simple-icons mark at a fixed size on the same
 * 24x24 grid, so every logo reads at the same size, or a two-letter monogram on a muted tint
 * of the name's hue. Brand colours too close to the tile take the foreground per theme.
 */
export function StackLogo({
  label,
  name,
  icon,
  size = "md",
}: {
  label: string;
  name: string;
  icon: LogoData | null;
  size?: "sm" | "md";
}) {
  const box = size === "md" ? "size-10 rounded-[10px]" : "size-7 rounded-[8px]";
  if (!icon) {
    const hue = monogramHue(name);
    return (
      <span
        aria-hidden
        style={
          {
            "--mono-l": `hsl(${hue} 32% 88%)`,
            "--mono-d": `hsl(${hue} 22% 22%)`,
          } as CSSProperties
        }
        className={cn(
          box,
          "text-fg border-line grid shrink-0 place-items-center border bg-[var(--mono-l)] font-semibold dark:bg-[var(--mono-d)]",
          size === "md" ? "text-[14px]" : "text-[11px]"
        )}
      >
        {monogram(label)}
      </span>
    );
  }
  return (
    <span
      aria-hidden
      style={
        {
          "--logo-l": icon.light ?? "var(--fg)",
          "--logo-d": icon.dark ?? "var(--fg)",
        } as CSSProperties
      }
      className={cn(
        box,
        "bg-surface-2 border-line grid shrink-0 place-items-center border text-[var(--logo-l)] dark:text-[var(--logo-d)]"
      )}
    >
      <svg
        viewBox="0 0 24 24"
        className={size === "md" ? "size-[22px]" : "size-4"}
        fill="currentColor"
        focusable="false"
      >
        <path d={icon.path} />
      </svg>
    </span>
  );
}
