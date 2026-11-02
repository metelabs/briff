import Link from "next/link";
import type { ReactNode } from "react";

import { Logo } from "@/components/logo/Logo";
import { cn } from "@/lib/utils";

/**
 * The one layout rule (DESIGN.md §6): the top bar's inner row and every page body share this
 * max-width and gutter, so header and content edges line up on every page. Wide content (the
 * Stack table) scrolls inside its card; the container never widens.
 */
export const PAGE_CONTAINER = "gutter mx-auto w-full max-w-[1200px]";

export function PageContainer({
  as: Tag = "div",
  className,
  children,
}: {
  as?: "div" | "main" | "header";
  className?: string;
  children: ReactNode;
}) {
  return <Tag className={cn(PAGE_CONTAINER, className)}>{children}</Tag>;
}

/**
 * Header of the pages outside the shell (login, onboarding, a bulletin opened from email). The
 * logo goes to `/`: the landing page for a visitor without a session, Home for a member.
 */
export function MinimalHeader({ children }: { children?: ReactNode }) {
  return (
    <PageContainer as="header" className="flex min-h-14 items-center justify-between md:min-h-16">
      <Link href="/" aria-label="Briff home" className="rounded-[6px]">
        <Logo size={24} />
      </Link>
      {children}
    </PageContainer>
  );
}
