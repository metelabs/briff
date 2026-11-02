import type { MetadataRoute } from "next";

import {
  LEGAL_PATHS,
  PRICING_PATH,
  PRIVATE_PREFIXES,
  STATUS_PATH,
} from "@/components/landing/links";
import { DOCS_BASE } from "@/lib/docs/nav";
import { isCloud } from "@/lib/env";
import { publicSiteUrl } from "@/lib/public-site";

// Request-time: the sitemap URL comes from the env, which the build does not have.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: [
        "/",
        "/replay/",
        ...(isCloud() ? [PRICING_PATH] : []),
        ...LEGAL_PATHS,
        STATUS_PATH,
        DOCS_BASE,
        "/.well-known/security.txt",
      ],
      disallow: [...PRIVATE_PREFIXES],
    },
    sitemap: `${publicSiteUrl()}/sitemap.xml`,
  };
}
