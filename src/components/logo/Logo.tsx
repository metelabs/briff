import type { CSSProperties, ReactElement } from "react";

export type LogoVariant = "lockup" | "mark" | "wordmark";
export type LogoTone = "auto" | "light" | "dark" | "mono";

export interface LogoProps {
  variant?: LogoVariant;
  /** Rendered height in px; width follows the artwork's aspect ratio. */
  size?: number;
  /** "auto": disc uses var(--brand), word uses currentColor, so the app theme drives both. */
  tone?: LogoTone;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

const DISC = "M10 30A26 26 0 0 1 62 30Z M2 34A26 26 0 0 0 54 34Z";
const WORD =
  "M99.26 58.7Q96.18 58.7 93.86 57.36Q91.54 56.03 89.98 53.59L89.74 58H83.6V17.4H90.09V33.29Q91.6 30.91 93.92 29.61Q96.24 28.3 99.26 28.3Q103.2 28.3 106.13 30.19Q109.06 32.07 110.71 35.47Q112.36 38.86 112.36 43.5Q112.36 48.08 110.71 51.5Q109.06 54.93 106.13 56.81Q103.2 58.7 99.26 58.7ZM97.63 52.78Q99.95 52.78 101.75 51.59Q103.55 50.4 104.62 48.31Q105.69 46.23 105.69 43.5Q105.69 40.77 104.68 38.69Q103.66 36.6 101.87 35.44Q100.07 34.28 97.69 34.28Q95.49 34.28 93.75 35.44Q92.01 36.6 91.05 38.69Q90.09 40.77 90.09 43.5Q90.09 46.23 91.05 48.31Q92.01 50.4 93.72 51.59Q95.43 52.78 97.63 52.78ZM117.35 58V29H123.85V34.28Q125.59 31.55 128.37 30.22Q131.16 28.88 134.11 28.88V35.09Q131.45 35.09 129.1 35.81Q126.75 36.54 125.3 38.16Q123.85 39.79 123.85 42.46V58ZM138.23 58V29H144.67V58ZM141.48 23.49Q139.91 23.49 138.78 22.36Q137.65 21.23 137.65 19.66Q137.65 18.1 138.78 16.99Q139.91 15.89 141.48 15.89Q143.05 15.89 144.18 16.99Q145.31 18.1 145.31 19.66Q145.31 21.23 144.18 22.36Q143.05 23.49 141.48 23.49ZM154.65 58V34.34H149.66V29H154.65V25.93Q154.65 21.34 156.94 18.88Q159.23 16.41 163.87 16.41Q165.38 16.41 167.09 16.91Q168.8 17.4 170.36 18.21L167.99 23.03Q166.88 22.5 166.04 22.27Q165.2 22.04 164.56 22.04Q162.82 22.04 161.98 23.17Q161.14 24.3 161.14 26.85V29H168.74V34.34H161.14V58ZM176.34 58V34.34H171.35V29H176.34V25.93Q176.34 21.34 178.63 18.88Q180.92 16.41 185.56 16.41Q187.07 16.41 188.78 16.91Q190.49 17.4 192.06 18.21L189.68 23.03Q188.58 22.5 187.73 22.27Q186.89 22.04 186.26 22.04Q184.52 22.04 183.67 23.17Q182.83 24.3 182.83 26.85V29H190.43V34.34H182.83V58Z";

const VIEWBOX: Record<LogoVariant, string> = {
  lockup: "2 4 190.06 56",
  mark: "0 0 64 64",
  wordmark: "83.6 15.89 108.46 42.8",
};

const ASPECT: Record<LogoVariant, number> = {
  lockup: 3.39,
  mark: 1,
  wordmark: 2.53,
};

const TONES: Record<LogoTone, { disc: string; word: string }> = {
  auto: { disc: "var(--brand, #0b6b67)", word: "currentColor" },
  light: { disc: "#0b6b67", word: "#141b1e" },
  dark: { disc: "#3ccfc2", word: "#e6ecee" },
  mono: { disc: "currentColor", word: "currentColor" },
};

export function Logo({
  variant = "lockup",
  size = 32,
  tone = "auto",
  title = "Briff",
  className,
  style,
}: LogoProps): ReactElement {
  const colors = TONES[tone];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={VIEWBOX[variant]}
      width={Math.round(size * ASPECT[variant] * 100) / 100}
      height={size}
      role="img"
      aria-label={title}
      className={className}
      style={style}
    >
      {variant !== "wordmark" && <path fill={colors.disc} d={DISC} />}
      {variant !== "mark" && <path fill={colors.word} d={WORD} />}
    </svg>
  );
}

export default Logo;
