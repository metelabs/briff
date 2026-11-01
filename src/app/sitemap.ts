import type { MetadataRoute } from "next";

import { publicPaths } from "@/components/landing/links";
import { isCloud } from "@/lib/env";
import { publicSiteUrl } from "@/lib/public-site";

// Request-time: the site URL comes from the env, which the build does not have.
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = publicSiteUrl();
  return publicPaths({ pricing: isCloud() }).map((path) => ({
    url: path === "/" ? `${base}/` : `${base}${path}`,
    changeFrequency: "monthly",
    priority: path === "/" ? 1 : 0.6,
  }));
}
