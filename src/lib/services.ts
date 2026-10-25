// Package -> service mapping (plan §7.1). A service is the vendor or platform
// behind a package; its announcements matter even when no package release does.
// Patterns: exact name, or a trailing `*` for prefixes (`@sentry/*`, `expo-*`).
// Traits feed the matcher: curated platform feeds (Apple, Android, Play) list the
// traits they are relevant to.

export interface ServiceDefinition {
  key: string;
  name: string;
  homepage?: string;
  packages: string[];
  traits: string[];
}

export const SERVICES: ServiceDefinition[] = [
  {
    key: "revenuecat",
    name: "RevenueCat",
    homepage: "https://www.revenuecat.com",
    packages: ["react-native-purchases", "react-native-purchases-ui", "@revenuecat/*"],
    traits: ["mobile", "ios", "android", "in-app-purchases"],
  },
  {
    key: "sentry",
    name: "Sentry",
    homepage: "https://sentry.io",
    packages: ["@sentry/*"],
    traits: [],
  },
  {
    key: "expo",
    name: "Expo / EAS",
    homepage: "https://expo.dev",
    packages: ["expo", "expo-*", "@expo/*", "eas-cli"],
    traits: ["mobile", "ios", "android", "react-native", "expo"],
  },
  {
    key: "react-native",
    name: "React Native",
    homepage: "https://reactnative.dev",
    packages: ["react-native", "@react-native/*"],
    traits: ["mobile", "ios", "android", "react-native"],
  },
  {
    key: "admob",
    name: "Google AdMob",
    homepage: "https://admob.google.com",
    packages: ["react-native-google-mobile-ads"],
    traits: ["mobile", "ios", "android", "ads"],
  },
  {
    key: "firebase",
    name: "Firebase",
    homepage: "https://firebase.google.com",
    packages: ["firebase", "firebase-admin", "@react-native-firebase/*", "@firebase/*"],
    traits: [],
  },
  {
    key: "nextjs",
    name: "Next.js",
    homepage: "https://nextjs.org",
    packages: ["next", "@next/*"],
    traits: ["web", "nextjs"],
  },
  // Hosting and AI Gateway: separate from the framework, so using `next` does not
  // make an org a Vercel customer.
  {
    key: "vercel",
    name: "Vercel",
    homepage: "https://vercel.com",
    packages: ["@vercel/*"],
    traits: [],
  },
  {
    key: "anthropic",
    name: "Anthropic",
    homepage: "https://www.anthropic.com",
    packages: ["@anthropic-ai/*"],
    traits: ["llm", "anthropic"],
  },
  {
    key: "openai",
    name: "OpenAI",
    homepage: "https://openai.com",
    packages: ["openai", "@openai/*"],
    traits: ["llm"],
  },
  {
    key: "supabase",
    name: "Supabase",
    homepage: "https://supabase.com",
    packages: ["@supabase/*", "supabase"],
    traits: [],
  },
  {
    key: "prisma",
    name: "Prisma",
    homepage: "https://www.prisma.io",
    packages: ["prisma", "@prisma/*"],
    traits: [],
  },
  {
    key: "payload",
    name: "Payload CMS",
    homepage: "https://payloadcms.com",
    packages: ["payload", "@payloadcms/*"],
    traits: ["web"],
  },
  {
    key: "stripe",
    name: "Stripe",
    homepage: "https://stripe.com",
    packages: ["stripe", "@stripe/*"],
    traits: [],
  },
  {
    key: "resend",
    name: "Resend",
    homepage: "https://resend.com",
    packages: ["resend"],
    traits: [],
  },
  {
    key: "better-auth",
    name: "Better Auth",
    homepage: "https://better-auth.com",
    packages: ["better-auth", "@better-auth/*"],
    traits: [],
  },
];

function matchesPattern(name: string, pattern: string): boolean {
  return pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : name === pattern;
}

/** First service whose pattern matches; exact patterns win over prefixes. */
export function serviceForPackage(name: string): ServiceDefinition | null {
  for (const service of SERVICES) {
    if (service.packages.some((p) => !p.endsWith("*") && p === name)) return service;
  }
  for (const service of SERVICES) {
    if (service.packages.some((p) => matchesPattern(name, p))) return service;
  }
  return null;
}

export function serviceByKey(key: string): ServiceDefinition | null {
  return SERVICES.find((s) => s.key === key) ?? null;
}
