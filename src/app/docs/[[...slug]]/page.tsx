import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DocsContent } from "@/components/docs/docs-content";
import { OG_IMAGE } from "@/components/landing/links";
import { editUrl, loadDocs } from "@/lib/docs/build";
import { docsHref, findDocsPage, neighbours } from "@/lib/docs/nav";
import { caps } from "@/lib/i18n";
import { publicSiteUrl } from "@/lib/public-site";

// Public (docs/LANDING.md): no session, no tenant data; per request for the site URL, with the
// rendered markdown cached per process (src/lib/docs/build.ts).
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug?: string[] }>;
}

async function pageFor(params: Props["params"]) {
  const { slug = [] } = await params;
  const key = slug.join("/");
  if (!findDocsPage(key)) return null;
  return (await loadDocs()).pages.get(key) ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await pageFor(params);
  if (!page) return {};
  const title = page.slug === "" ? "Briff docs" : `${page.title} · Briff docs`;
  const description = page.description || `${page.title}: Briff documentation.`;
  const path = docsHref(page.slug);
  return {
    metadataBase: new URL(publicSiteUrl()),
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url: path,
      siteName: "Briff",
      type: "article",
      images: [OG_IMAGE],
    },
    robots: { index: true, follow: true },
  };
}

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export default async function DocsPage({ params }: Props) {
  const page = await pageFor(params);
  if (!page) notFound();
  const { prev, next } = neighbours(page.slug);
  return (
    <div className="min-[1280px]:grid min-[1280px]:grid-cols-[minmax(0,1fr)_200px] min-[1280px]:gap-10">
      <article className="max-w-[72ch] min-w-0">
        <header className="mb-8">
          <p className="type-label text-brand mb-2">{caps(page.section)}</p>
          <h1 className="type-page mb-3 text-balance">{page.title}</h1>
          <p className="text-fg-muted flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
            {page.lastUpdated && (
              <span>
                Last updated{" "}
                <time dateTime={page.lastUpdated}>{DATE.format(new Date(page.lastUpdated))}</time>
              </span>
            )}
            <a
              href={editUrl(page.files[0])}
              target="_blank"
              rel="noreferrer"
              className="hover:text-fg underline underline-offset-4"
            >
              Edit this page on GitHub
            </a>
          </p>
        </header>
        <DocsContent tree={page.hast} />
        <nav
          aria-label="Previous and next page"
          className="border-line mt-14 grid gap-3 border-t pt-6 min-[560px]:grid-cols-2"
        >
          {prev ? (
            <Link href={docsHref(prev.slug)} className="docs-pager">
              <span className="text-fg-muted flex items-center gap-1.5 text-[12.5px]">
                <ArrowLeft aria-hidden className="size-3.5" /> Previous
              </span>
              <span className="font-medium">{prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link href={docsHref(next.slug)} className="docs-pager min-[560px]:text-right">
              <span className="text-fg-muted flex items-center gap-1.5 text-[12.5px] min-[560px]:justify-end">
                Next <ArrowRight aria-hidden className="size-3.5" />
              </span>
              <span className="font-medium">{next.title}</span>
            </Link>
          )}
        </nav>
      </article>
      {page.toc.length > 1 && (
        <aside className="hidden min-[1280px]:block">
          <nav
            aria-label="On this page"
            className="no-scrollbar sticky top-6 max-h-[calc(100svh-48px)] overflow-y-auto"
          >
            <p className="text-fg-muted mb-2 text-[12.5px] font-medium">On this page</p>
            <ol className="grid gap-1 text-[13px]">
              {page.toc.map((entry) => (
                <li key={entry.id} className={entry.depth === 3 ? "pl-3" : undefined}>
                  <a
                    href={`#${entry.id}`}
                    className="text-fg-muted hover:text-fg block py-0.5 leading-[1.4] underline-offset-4 hover:underline"
                  >
                    {entry.text}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>
      )}
    </div>
  );
}
