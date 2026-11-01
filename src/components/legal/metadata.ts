import type { Metadata } from "next";

import { OG_IMAGE } from "@/components/landing/links";
import { publicSiteUrl } from "@/lib/public-site";

import type { LegalDoc } from "./legal-page";

/** Metadata of a legal page; the site URL is read at request time like on every public page. */
export function legalMetadata(doc: LegalDoc, description: string): Metadata {
  const title = `${doc.title} · Briff`;
  return {
    metadataBase: new URL(publicSiteUrl()),
    title,
    description,
    alternates: { canonical: doc.path },
    openGraph: {
      title,
      description,
      url: doc.path,
      siteName: "Briff",
      type: "article",
      images: [OG_IMAGE],
    },
    robots: { index: true, follow: true },
  };
}
