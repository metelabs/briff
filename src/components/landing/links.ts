import { PUBLIC_REPLAY_IDS } from "@/replay/public-ids";

// Where the public pages point outside the app. The repository is private until it is
// opened; every source link is built from SOURCE_URL, so this is the one place to change.
export const SOURCE_URL = "https://github.com/metelabs/briff";

/** The docs site (src/app/docs), built from the repository's markdown (docs/_nav.json). */
export const DOCS_URL = "/docs";
/** Running your own instance. */
export const SELF_HOST_URL = "/docs/self-hosting/install";
/** What leaves your server (docs/PRIVACY.md). */
export const PRIVACY_URL = "/docs/trust/privacy";
export const METELABS_URL = "https://metelabs.dev";
export const SECURITY_POLICY_URL = "/docs/trust/security";

/** The public status page (src/app/status); /api/health stays the machine-readable check. */
export const STATUS_PATH = "/status";

/** The legal and trust links both footers (public pages and the app shell) start with. */
export const TRUST_LINKS = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: SECURITY_POLICY_URL, label: "Security" },
  { href: STATUS_PATH, label: "Status" },
] as const;

/** Legal pages, public and listed in the sitemap. */
export const LEGAL_PATHS = ["/terms", "/privacy", "/refunds", "/dpa"] as const;

/** Social preview image (the brand's og-image, the same file as src/app/opengraph-image.png). */
export const OG_IMAGE = { url: "/brand/og-image.png", width: 1200, height: 630, alt: "Briff" };

/** The plans page; public on the hosted service only (BRIFF_CLOUD), a 404 when self-hosted. */
export const PRICING_PATH = "/pricing";

/** Public routes, in the order the sitemap lists them. */
export function publicPaths({ pricing }: { pricing: boolean }): readonly string[] {
  return [
    "/",
    ...(pricing ? [PRICING_PATH] : []),
    ...PUBLIC_REPLAY_IDS.map((id) => `/replay/${id}`),
    ...LEGAL_PATHS,
    STATUS_PATH,
  ];
}

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
  "/forgot-password",
  "/invite/",
  "/landing",
  "/login",
  "/onboarding",
  "/profile",
  "/repos",
  "/reset-password",
  "/settings",
  "/stack",
  "/streams",
] as const;
