import type { NextConfig } from "next";

/** Markdown the docs pages are built from (docs/_nav.json), plus the licence they link to. */
export const DOCS_SOURCES = [
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "LICENSE",
  "docs/*.md",
  "docs/getting-started/*.md",
];

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Loaded only when SENTRY_DSN is set (src/lib/sentry.ts); kept out of the server bundle.
  serverExternalPackages: ["@sentry/node"],
  // The app is fully dynamic (auth + database on every page); Cache Components
  // would only add prerender constraints without a payoff.
  cacheComponents: false,
  // The public replays (/landing, /replay/<id>) read the adapters' fixtures at runtime
  // (src/replay/fixtures.ts); ship them in the standalone output.
  outputFileTracingIncludes: {
    "/landing": ["./src/sources/__fixtures__/**/*"],
    "/replay/*": ["./src/sources/__fixtures__/**/*"],
    // The docs site reads the repository's markdown at runtime (src/lib/docs/build.ts); a test
    // keeps these globs and .dockerignore in step with docs/_nav.json.
    "/docs/\\[\\[\\.\\.\\.slug\\]\\]": DOCS_SOURCES.map((file) => `./${file}`),
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
