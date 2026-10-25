import localFont from "next/font/local";

// Self-hosted (next/font/google would make the build depend on Google). Latin subsets of
// the Google Fonts files; licences (SIL OFL 1.1) sit next to them in ./fonts.

export const bricolage = localFont({
  src: "./fonts/BricolageGrotesque-latin.woff2",
  weight: "500 700",
  variable: "--font-bricolage",
  display: "swap",
});

export const geist = localFont({
  src: "./fonts/Geist-latin.woff2",
  weight: "400 600",
  variable: "--font-geist",
  display: "swap",
});

export const geistMono = localFont({
  src: "./fonts/GeistMono-latin.woff2",
  weight: "400 500",
  variable: "--font-geist-mono",
  display: "swap",
});
