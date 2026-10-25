import type { NextConfig } from "next";

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
  // The app is fully dynamic (auth + database on every page); Cache Components
  // would only add prerender constraints without a payoff.
  cacheComponents: false,
  // The public replays (/landing, /replay/<id>) read the adapters' fixtures at runtime
  // (src/replay/fixtures.ts); ship them in the standalone output.
  outputFileTracingIncludes: {
    "/landing": ["./src/sources/__fixtures__/**/*"],
    "/replay/*": ["./src/sources/__fixtures__/**/*"],
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
