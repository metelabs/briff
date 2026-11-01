import Link from "next/link";
import type { ReactNode } from "react";

import { PublicFooter, PublicHeader } from "@/components/landing/public-chrome";
import { PageContainer } from "@/components/shell/page-container";
import { Card } from "@/components/ui/card";
import { LEGAL_LAST_UPDATED } from "@/lib/legal";
import { cn } from "@/lib/utils";

// One layout for the legal pages: the public header and footer, a prose column of at most
// 72ch and, for long pages, a table of contents (sticky beside the text from 980px, a card
// above it on smaller screens). Content is plain data so a test can render it without Next.

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

export interface LegalDoc {
  path: string;
  title: string;
  lead: ReactNode;
  sections: LegalSection[];
}

/** Pages with at least this many sections get a table of contents. */
const TOC_MIN_SECTIONS = 5;

export function LegalArticle({ doc }: { doc: LegalDoc }) {
  const toc = doc.sections.length >= TOC_MIN_SECTIONS;
  return (
    <div
      className={cn(
        "grid gap-8 pt-7 pb-16 md:pt-10",
        toc && "min-[980px]:grid-cols-[220px_minmax(0,1fr)] min-[980px]:gap-12"
      )}
    >
      {toc && (
        <nav aria-label="On this page" className="min-[980px]:order-first">
          <Card className="p-4 min-[980px]:sticky min-[980px]:top-6 min-[980px]:border-0 min-[980px]:bg-transparent min-[980px]:p-0">
            <p className="text-fg-muted mb-2 text-[12.5px] font-medium">On this page</p>
            <ol className="grid gap-1 text-[13.5px]">
              {doc.sections.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="text-fg-muted hover:text-fg block rounded-[6px] py-0.5 underline-offset-4 hover:underline"
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </Card>
        </nav>
      )}
      <article className="max-w-[72ch] min-w-0">
        <header className="rise mb-8">
          <h1 className="type-page mb-3 text-balance">{doc.title}</h1>
          <div className="text-fg-muted text-[16px] leading-[1.5]">{doc.lead}</div>
          <p className="text-fg-muted mt-3 text-[12.5px]">
            Last updated <time dateTime={LEGAL_LAST_UPDATED}>{LEGAL_LAST_UPDATED}</time>
          </p>
        </header>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-9">
          {doc.sections.map((s) => (
            <section key={s.id} aria-labelledby={s.id}>
              <h2 id={s.id} className="type-h2 mb-3 scroll-mt-6">
                {s.title}
              </h2>
              <div className="legal-prose">{s.body}</div>
            </section>
          ))}
        </div>
      </article>
    </div>
  );
}

export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <div className="flex min-h-svh flex-col">
      <PublicHeader />
      <PageContainer as="main">
        <LegalArticle doc={doc} />
      </PageContainer>
      <PublicFooter />
    </div>
  );
}

/** A link inside legal text: internal paths through next/link, the rest in a new tab. */
export function A({ href, children }: { href: string; children: ReactNode }) {
  const cls = "text-brand font-medium underline underline-offset-4";
  if (href.startsWith("/")) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  const external = href.startsWith("http");
  return (
    <a href={href} className={cls} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
      {children}
    </a>
  );
}

/** A two- or three-column table that scrolls inside its card on narrow screens. */
export function LegalTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <Card className="my-4 overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-left text-[13.5px]">
        <thead className="bg-surface-2 text-fg-muted">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-2.5 text-[12px] font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-line border-t align-top">
              {row.map((cell, j) => (
                <td key={j} className={cn("px-4 py-2.5", j === 0 && "font-medium")}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
