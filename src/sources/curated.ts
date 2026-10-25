// Curated official feeds (plan §7.2). Every URL was checked to answer 200 with a
// parseable feed; vendors without a feed are listed in docs/SOURCES.md instead of
// being scraped. `traits` decide which orgs a feed is relevant to: "always" means
// every org (tools the operator uses regardless of package manifests).
// Runtime sources (`runtime`) reach orgs whose repos declare that runtime; see
// RUNTIME_SOURCES below and docs/SOURCES.md for the verification and the gaps.

import type { RuntimeId } from "@scan/runtimes";

import { advisoriesUrl } from "./github-advisories";

export type CuratedKind = "rss" | "changelog_md" | "github_advisories";

/** security: fetched hourly, runtime security items emailed without the LLM; others every 6h. */
export type SourceClass = "security" | "releases" | "news";

export interface CuratedSource {
  name: string;
  kind: CuratedKind;
  url: string;
  serviceKey?: string;
  traits: string[];
  /** Human page for changelog_md sources; item links point at its anchors. */
  pageUrl?: string;
  runtime?: RuntimeId;
  /** Defaults to `news`. */
  class?: SourceClass;
}

const PLATFORM_SOURCES: CuratedSource[] = [
  {
    name: "Claude Platform release notes",
    kind: "rss",
    url: "https://platform.claude.com/docs/en/release-notes/feed.xml",
    serviceKey: "anthropic",
    traits: ["always"],
  },
  {
    name: "Claude Code",
    kind: "changelog_md",
    url: "https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md",
    pageUrl: "https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md",
    traits: ["always"],
  },
  {
    name: "Expo blog",
    kind: "rss",
    url: "https://expo.dev/blog/rss.xml",
    serviceKey: "expo",
    traits: ["expo"],
  },
  {
    name: "Expo changelog",
    kind: "rss",
    url: "https://expo.dev/changelog/rss.xml",
    serviceKey: "expo",
    traits: ["expo"],
  },
  {
    name: "Next.js blog",
    kind: "rss",
    url: "https://nextjs.org/feed.xml",
    serviceKey: "nextjs",
    traits: ["nextjs"],
  },
  {
    name: "Vercel blog",
    kind: "rss",
    url: "https://vercel.com/atom",
    serviceKey: "vercel",
    traits: [],
  },
  {
    name: "RevenueCat blog",
    kind: "rss",
    url: "https://www.revenuecat.com/blog/rss.xml",
    serviceKey: "revenuecat",
    traits: ["in-app-purchases"],
  },
  {
    name: "Sentry changelog",
    kind: "rss",
    url: "https://sentry.io/changelog/feed.xml",
    serviceKey: "sentry",
    traits: [],
  },
  {
    name: "Dokploy releases",
    kind: "rss",
    url: "https://github.com/Dokploy/dokploy/releases.atom",
    traits: ["always"],
  },
  {
    name: "Apple Developer News",
    kind: "rss",
    url: "https://developer.apple.com/news/rss/news.rss",
    traits: ["ios"],
  },
  {
    name: "Android Developers Blog",
    kind: "rss",
    url: "https://android-developers.googleblog.com/feeds/posts/default",
    traits: ["android"],
  },
];

function feed(
  runtime: RuntimeId,
  sourceClass: SourceClass,
  name: string,
  url: string
): CuratedSource {
  return { name, kind: "rss", url, traits: [], runtime, class: sourceClass };
}

function advisories(runtime: RuntimeId, owner: string, repo: string): CuratedSource {
  return {
    name: `${owner}/${repo} security advisories`,
    kind: "github_advisories",
    url: advisoriesUrl(owner, repo),
    traits: [],
    runtime,
    class: "security",
  };
}

/**
 * Official security and release channels per runtime id (packages/scan/src/runtimes.ts).
 * Every URL answered 200 and parsed on 22 Oct 2026; GitHub advisory repos are the
 * ones that publish advisories. Runtimes without a channel are listed in docs/SOURCES.md.
 */
export const RUNTIME_SOURCES: CuratedSource[] = [
  feed("php", "security", "PHP news", "https://www.php.net/feed.atom"),
  advisories("php", "php", "php-src"),
  feed(
    "node",
    "security",
    "Node.js vulnerability blog",
    "https://nodejs.org/en/feed/vulnerability.xml"
  ),
  feed("node", "releases", "Node.js releases", "https://nodejs.org/en/feed/releases.xml"),
  feed(
    "python",
    "security",
    "Python security-announce",
    "https://mail.python.org/archives/list/security-announce@python.org/feed/"
  ),
  feed("python", "releases", "Python releases", "https://www.python.org/downloads/feed.rss"),
  feed("go", "releases", "golang/go releases", "https://github.com/golang/go/tags.atom"),
  feed("ruby", "security", "Ruby news", "https://www.ruby-lang.org/en/feeds/news.rss"),
  advisories("dotnet", "dotnet", "runtime"),
  advisories("dotnet", "dotnet", "aspnetcore"),
  feed(
    "dotnet",
    "releases",
    "dotnet/core releases",
    "https://github.com/dotnet/core/releases.atom"
  ),
  feed("rust", "security", "Rust blog", "https://blog.rust-lang.org/feed.xml"),
  advisories("rust", "rust-lang", "rust"),
  feed("postgres", "security", "PostgreSQL news", "https://www.postgresql.org/news.rss"),
  feed("postgres", "releases", "PostgreSQL versions", "https://www.postgresql.org/versions.rss"),
  advisories("mariadb", "MariaDB", "server"),
  feed(
    "mariadb",
    "releases",
    "MariaDB/server releases",
    "https://github.com/MariaDB/server/releases.atom"
  ),
  advisories("redis", "redis", "redis"),
  feed("redis", "releases", "redis/redis releases", "https://github.com/redis/redis/releases.atom"),
  advisories("valkey", "valkey-io", "valkey"),
  feed(
    "valkey",
    "releases",
    "valkey-io/valkey releases",
    "https://github.com/valkey-io/valkey/releases.atom"
  ),
  feed("nginx", "security", "nginx news", "https://nginx.org/index.rss"),
  advisories("deno", "denoland", "deno"),
  feed(
    "deno",
    "releases",
    "denoland/deno releases",
    "https://github.com/denoland/deno/releases.atom"
  ),
  feed("bun", "releases", "oven-sh/bun releases", "https://github.com/oven-sh/bun/releases.atom"),
];

export const CURATED_SOURCES: CuratedSource[] = [...PLATFORM_SOURCES, ...RUNTIME_SOURCES];
