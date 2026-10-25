import { PUBLIC_REPLAY_IDS } from "@/replay/public-ids";

// Where the public pages point outside the app. The repository is private until it is
// opened; every source link is built from SOURCE_URL, so this is the one place to change.
export const SOURCE_URL = "https://github.com/metelabs/briff";

/** README section on running your own instance. */
export const SELF_HOST_URL = `${SOURCE_URL}#self-hosting`;
export const DOCS_URL = `${SOURCE_URL}#readme`;
export const PRIVACY_URL = `${SOURCE_URL}/blob/main/docs/PRIVACY.md`;
export const METELABS_URL = "https://metelabs.dev";

/** Social preview image (the brand's og-image, the same file as src/app/opengraph-image.png). */
export const OG_IMAGE = { url: "/brand/og-image.png", width: 1200, height: 630, alt: "Briff" };

/** Public routes, in the order the sitemap lists them. */
export const PUBLIC_PATHS: readonly string[] = [
  "/",
  ...PUBLIC_REPLAY_IDS.map((id) => `/replay/${id}`),
];

/**
 * Everything else the app serves, closed to crawlers (robots.ts). A test keeps it in step with
 * the route folders in src/app; /landing is the landing page's internal path (canonical `/`).
 */
export const PRIVATE_PREFIXES = [
  "/admin",
  "/alerts",
  "/api/",
  "/b/",
  "/bulletins",
  "/landing",
  "/login",
  "/onboarding",
  "/profile",
  "/repos",
  "/settings",
  "/stack",
  "/streams",
] as const;
