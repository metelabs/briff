import { PUBLIC_REPLAY_IDS } from "@/replay/public-ids";

// Where the public pages point outside the app. The repository is private until it is
// opened; every source link is built from SOURCE_URL, so this is the one place to change.
export const SOURCE_URL = "https://github.com/metelabs/briff";

/** README section on running your own instance. */
export const SELF_HOST_URL = `${SOURCE_URL}#self-hosting`;
export const DOCS_URL = `${SOURCE_URL}#readme`;
export const PRIVACY_URL = `${SOURCE_URL}/blob/main/docs/PRIVACY.md`;
export const METELABS_URL = "https://metelabs.dev";
export const SECURITY_POLICY_URL = `${SOURCE_URL}/blob/main/SECURITY.md`;

/** The legal and trust links both footers (public pages and the app shell) start with. */
export const TRUST_LINKS = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/pricing", label: "Pricing" },
  { href: SECURITY_POLICY_URL, label: "Security" },
  { href: "/api/health", label: "Status" },
] as const;

/** Legal pages, public and listed in the sitemap. */
export const LEGAL_PATHS = ["/terms", "/privacy", "/refunds", "/dpa"] as const;

/** Social preview image (the brand's og-image, the same file as src/app/opengraph-image.png). */
export const OG_IMAGE = { url: "/brand/og-image.png", width: 1200, height: 630, alt: "Briff" };

/** Public routes, in the order the sitemap lists them. */
export const PUBLIC_PATHS: readonly string[] = [
  "/",
  ...PUBLIC_REPLAY_IDS.map((id) => `/replay/${id}`),
  ...LEGAL_PATHS,
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
  "/forgot-password",
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
