import type { MetadataRoute } from "next";

import { PRIVATE_PREFIXES } from "@/components/landing/links";
import { publicSiteUrl } from "@/lib/public-site";

// Request-time: the sitemap URL comes from the env, which the build does not have.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: ["/", "/replay/"], disallow: [...PRIVATE_PREFIXES] },
    sitemap: `${publicSiteUrl()}/sitemap.xml`,
  };
}
