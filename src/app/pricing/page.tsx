import { ArrowUpRight, Check } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OG_IMAGE, SELF_HOST_URL } from "@/components/landing/links";
import { PublicFooter, PublicHeader } from "@/components/landing/public-chrome";
import { PageContainer } from "@/components/shell/page-container";
import { isCloud } from "@/lib/env";
import { INCLUDED_FEATURES, PLANS } from "@/lib/plans";
import { publicSiteUrl } from "@/lib/public-site";

import { PricingCards } from "./_client";

// Public, hosted service only: a self-hosted instance (BRIFF_CLOUD off) has no plans and answers
// 404 here. Rendered per request so the flag is read at request time, never at build.
export const dynamic = "force-dynamic";

const TITLE = "Pricing · Briff";
const DESCRIPTION = `Free for ${PLANS.free.repos} repos. Pro and Team for more repos, streams and people. Every plan gets the weekly bulletin and same-day security alerts; self-hosting is free and unlimited.`;

export function generateMetadata(): Metadata {
  if (!isCloud()) return {};
  return {
    metadataBase: new URL(publicSiteUrl()),
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: "/pricing" },
    openGraph: {
      title: TITLE,
      description: DESCRIPTION,
      url: "/pricing",
      siteName: "Briff",
      type: "website",
      images: [OG_IMAGE],
    },
    twitter: { card: "summary_large_image", images: [OG_IMAGE.url] },
    robots: { index: true, follow: true },
  };
}

const FAQ: { q: string; a: string }[] = [
  {
    q: "What counts as a repo?",
    a: "Every repository your organisation has in Briff: one a GitHub App installation scans, or one a scanner (briff-scan, the GitHub Action) uploads. A monorepo uploaded as one repo is one. A repo counts whether or not it is in a stream; removing it on Repos frees its slot.",
  },
  {
    q: "What happens when I reach a limit?",
    a: "Nothing is deleted and nothing stops working. New repos past the limit are refused: briff-scan reports the limit, the GitHub App leaves them unlinked and Repos says so. A new stream past the limit is refused the same way. Move to a larger plan or remove a repo, then rescan.",
  },
  {
    q: "Is self-hosting free?",
    a: "Yes, and unlimited. A self-hosted instance has no plans and no limits: one Docker image and Postgres, every feature, as many repos, streams and people as you like.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. A cancelled plan runs to the end of the period you paid for, then the organisation moves to Free. Your repos, streams and bulletins stay.",
  },
  {
    q: "Who sends the invoices?",
    a: "Paddle, our payment partner. Paddle is the merchant of record: it takes the payment and sends the invoice and receipts.",
  },
  {
    q: "What about VAT and sales tax?",
    a: "Paddle handles them: it adds the VAT or sales tax that applies where you are, and lets a business enter its VAT number at checkout.",
  },
];

export default function PricingPage() {
  if (!isCloud()) notFound();
  return (
    <div className="flex min-h-svh flex-col">
      <PublicHeader pricing />
      <PageContainer as="main" className="pb-20">
        <header className="rise mx-auto max-w-[720px] pt-10 pb-6 text-center md:pt-14">
          <p className="text-fg-muted text-[13px]">Pricing</p>
          <h1 className="type-page mt-2 text-balance">
            Every plan gets the whole product. Plans differ in repos, streams and people.
          </h1>
          <p className="text-fg-muted mx-auto mt-3 max-w-[56ch] text-[16px]">
            Pick by how many repos, streams and people you need. Everything else is the same on
            every plan, Free included.
          </p>
        </header>

        <p
          role="note"
          className="rise bg-brand-soft text-fg rounded-inset mx-auto mb-6 max-w-[720px] px-4 py-3 text-center text-[13.5px] [--i:1]"
        >
          <b className="font-semibold">Free during the beta:</b> Pro and Team start when billing
          opens; your plan stays {PLANS.free.name} until you choose to upgrade.
        </p>

        <PricingCards />

        <div className="rise bg-surface border-line rounded-card mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 border px-[18px] py-3.5 text-[14px] [--i:6]">
          <span className="text-fg-muted text-[13px]">Every plan includes</span>
          {INCLUDED_FEATURES.map((f) => (
            <span key={f} className="flex items-center gap-2">
              <Check aria-hidden className="text-ok size-4 shrink-0" />
              {f}
            </span>
          ))}
        </div>

        <p className="rise text-fg-muted mt-4 text-center text-[13px] [--i:7]">
          Running it yourself?{" "}
          <a
            href={SELF_HOST_URL}
            target="_blank"
            rel="noreferrer"
            className="text-brand inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline"
          >
            Self-hosting is free and unlimited
            <ArrowUpRight className="size-3.5" aria-hidden />
          </a>
        </p>

        <section aria-labelledby="faq" className="mx-auto mt-16 max-w-[720px]">
          <h2 id="faq" className="type-page text-[clamp(24px,3vw,32px)]">
            Questions
          </h2>
          <dl className="bg-surface border-line rounded-card mt-5 border">
            {FAQ.map((item) => (
              <div key={item.q} className="border-line border-t px-[18px] py-4 first:border-t-0">
                <dt className="text-[15px] font-medium">{item.q}</dt>
                <dd className="text-fg-muted mt-1.5 text-[14px]">{item.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </PageContainer>
      <PublicFooter pricing />
    </div>
  );
}
