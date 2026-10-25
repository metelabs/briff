import type { MetadataRoute } from "next";

import { PUBLIC_PATHS } from "@/components/landing/links";
import { publicSiteUrl } from "@/lib/public-site";

// Request-time: the site URL comes from the env, which the build does not have.
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = publicSiteUrl();
  return PUBLIC_PATHS.map((path) => ({
    url: path === "/" ? `${base}/` : `${base}${path}`,
    changeFrequency: "monthly",
    priority: path === "/" ? 1 : 0.6,
  }));
}
