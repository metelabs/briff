import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { ToastProvider } from "@/components/ui/toast";
import { themeAttribute } from "@/lib/theme";
import { readTheme } from "@/lib/theme-cookie";
import { cn } from "@/lib/utils";

import { bricolage, geist, geistMono } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Briff",
  description: "A weekly briefing built from your own stack.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0a1115" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The theme cookie is read on the server so the first paint already has the right theme.
  const theme = await readTheme();
  return (
    <html
      lang="en"
      data-theme={themeAttribute(theme)}
      className={cn(bricolage.variable, geist.variable, geistMono.variable)}
    >
      <body className="min-h-svh">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
