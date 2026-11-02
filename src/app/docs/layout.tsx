import type { ReactNode } from "react";

import { DocsMenu, DocsSidebar, type DocsNavGroup } from "@/components/docs/docs-nav";
import { DocsSearchProvider, SearchButton } from "@/components/docs/docs-search";
import { PublicFooter, PublicHeader } from "@/components/landing/public-chrome";
import { PageContainer } from "@/components/shell/page-container";
import { isCloud } from "@/lib/env";
import { caps } from "@/lib/i18n";
import { navLinks } from "@/lib/docs/nav";

// Public (docs/LANDING.md): the docs site, rendered from the repository's markdown. No session,
// no tenant data. Sidebar from 980px, a "Docs menu" sheet below.

export default function DocsLayout({ children }: { children: ReactNode }) {
  const pricing = isCloud();
  const groups: DocsNavGroup[] = navLinks().map((s) => ({ label: caps(s.title), links: s.links }));
  return (
    <DocsSearchProvider>
      <div className="flex min-h-svh flex-col">
        <PublicHeader pricing={pricing} />
        <PageContainer className="flex-1 pt-4 pb-16 min-[980px]:grid min-[980px]:grid-cols-[232px_minmax(0,1fr)] min-[980px]:gap-10 min-[980px]:pt-8">
          <aside className="hidden min-[980px]:block">
            <div className="no-scrollbar sticky top-6 grid max-h-[calc(100svh-48px)] gap-5 overflow-y-auto pb-6">
              <SearchButton />
              <DocsSidebar groups={groups} />
            </div>
          </aside>
          <div className="mb-6 flex gap-2 min-[980px]:hidden">
            <DocsMenu groups={groups} />
            <SearchButton className="flex-1" />
          </div>
          <main className="min-w-0">{children}</main>
        </PageContainer>
        <PublicFooter pricing={pricing} />
      </div>
    </DocsSearchProvider>
  );
}
