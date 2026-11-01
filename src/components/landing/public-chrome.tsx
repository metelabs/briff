import Link from "next/link";
import type { ReactNode } from "react";

import { Logo } from "@/components/logo/Logo";
import { PageContainer } from "@/components/shell/page-container";
import { buttonVariants } from "@/components/ui/button";
import { SUPPORT_EMAIL } from "@/lib/legal";
import { cn } from "@/lib/utils";

import packageJson from "../../../package.json";
import { DOCS_URL, METELABS_URL, SOURCE_URL, TRUST_LINKS } from "./links";

// Header and footer of the public pages (landing, replays): the minimal header's logo
// position (DESIGN.md §2) plus a few section links and Sign in; no session, no shell.

const NAV = [
  { href: "/#replays", label: "Replays" },
  { href: "/#coverage", label: "Coverage" },
  { href: "/#reads", label: "What it reads" },
  { href: "/#sample", label: "Sample" },
  { href: "/#privacy", label: "Privacy" },
] as const;

/** `pricing`: the hosted service (BRIFF_CLOUD); a self-hosted instance never links to plans. */
export function PublicHeader({ pricing = false }: { pricing?: boolean }) {
  const nav = pricing ? [...NAV, { href: "/pricing", label: "Pricing" }] : NAV;
  return (
    <PageContainer as="header" className="flex min-h-14 items-center justify-between md:min-h-16">
      <Link href="/" aria-label="Briff home" className="rounded-[6px]">
        <Logo size={24} />
      </Link>
      <nav aria-label="Sections" className="flex items-center gap-1">
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="text-fg-muted hover:text-fg hover:bg-surface hidden rounded-full px-3 py-1.5 text-[14px] font-medium transition-colors duration-150 md:inline-block"
          >
            {item.label}
          </Link>
        ))}
        <Link href="/login" className={cn(buttonVariants({ size: "md" }), "ml-2")}>
          Sign in
        </Link>
      </nav>
    </PageContainer>
  );
}

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  const external = href.startsWith("http");
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className="hover:text-fg underline-offset-4 transition-colors duration-150 hover:underline"
    >
      {children}
    </a>
  );
}

/** One muted line, like the shell's footer (DESIGN.md §8), with the public links. */
export function PublicFooter({ pricing = false }: { pricing?: boolean }) {
  return (
    <footer className="border-line mt-auto border-t">
      <PageContainer className="text-fg-muted flex flex-wrap items-center gap-x-5 gap-y-1 py-5 text-[12.5px]">
        {TRUST_LINKS.map((link) => (
          <FooterLink key={link.label} href={link.href}>
            {link.label}
          </FooterLink>
        ))}
        <span>Contact: {SUPPORT_EMAIL}</span>
        <FooterLink href={DOCS_URL}>Docs</FooterLink>
        {pricing && <FooterLink href="/pricing">Pricing</FooterLink>}
        <FooterLink href={SOURCE_URL}>Source</FooterLink>
        <FooterLink href={METELABS_URL}>Made by Metelabs</FooterLink>
        <span className="font-mono tabular-nums">Briff {packageJson.version}</span>
      </PageContainer>
    </footer>
  );
}
