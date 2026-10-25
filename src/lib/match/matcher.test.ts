import { describe, expect, it } from "vitest";

import { parseDockerfile } from "@scan/runtimes";

import {
  matchItem,
  runtimesOf,
  type MatchSource,
  type OrgStack,
  SCORES,
  stackPackageKey,
  tokenize,
} from "./matcher";

function stack(): OrgStack {
  const pkg = (name: string, direct: boolean, repo: string, serviceKey: string | null = null) => ({
    packageId: `pkg_${name}`,
    name,
    direct,
    repoIds: new Set([repo]),
    serviceKey,
  });
  const packages = new Map(
    [
      pkg("next", true, "web"),
      pkg("react-native-purchases", true, "app", "revenuecat"),
      pkg("@sentry/react-native", true, "app", "sentry"),
      pkg("loose-envify", false, "web"),
    ].map((p) => [p.name, p])
  );
  return {
    orgId: "org",
    packages,
    packagesByFeed: new Map([
      ["https://github.com/vercel/next.js/releases.atom", ["next"]],
      ["https://github.com/zertosh/loose-envify/releases.atom", ["loose-envify"]],
    ]),
    services: new Map([
      ["revenuecat", { key: "revenuecat", name: "RevenueCat", repoIds: new Set(["app"]) }],
      ["sentry", { key: "sentry", name: "Sentry", repoIds: new Set(["app"]) }],
    ]),
    runtimes: new Map(),
    traits: new Set(["ios", "android"]),
  };
}

const rss = (
  url: string,
  serviceKey: string | null = null,
  traits: string[] = [],
  runtime: string | null = null
): MatchSource => ({
  kind: "rss",
  url,
  serviceKey,
  traits,
  runtime,
});

/** An org whose `site` repo runs php:8.3-fpm (from its Dockerfile) and whose `api` repo is Node. */
function runtimeStack(): OrgStack {
  const rows = [
    ...parseDockerfile("FROM node:22 AS assets\nFROM php:8.3-fpm\n", "Dockerfile").map((r) => ({
      ...r,
      repoId: "site",
    })),
    { repoId: "api", name: "node", version: "22", normalized: "22" },
    { repoId: "api", name: "image", version: "ghcr.io/acme/php-tools:1", normalized: null },
  ];
  return { ...stack(), runtimes: runtimesOf(rows) };
}

describe("runtime matching", () => {
  const phpSecurity = rss("https://example.com/php-security.xml", null, [], "php");

  it("matches a runtime source to the repos that declare the runtime, at release weight", () => {
    const m = matchItem(
      { title: "PHP 8.3.36 released", rawText: "Fixes two critical RCEs." },
      phpSecurity,
      runtimeStack()
    );
    expect(m).toEqual({
      score: SCORES.runtime,
      reason: "runtime:php",
      packageId: null,
      serviceKey: null,
      repoIds: ["site"],
    });
    expect(SCORES.runtime).toBe(SCORES.directRelease);
  });

  it("does not match an org without that runtime", () => {
    expect(matchItem({ title: "PHP 8.3.36", rawText: "" }, phpSecurity, stack())).toBeNull();
  });

  it("merges repos and versions per runtime and leaves unmapped images out", () => {
    const runtimes = runtimeStack().runtimes;
    expect([...runtimes.keys()].sort()).toEqual(["node", "php"]);
    expect(runtimes.get("node")).toEqual({
      name: "node",
      versions: new Set(["22"]),
      repoIds: new Set(["site", "api"]),
    });
    expect(runtimes.get("php")?.versions).toEqual(new Set(["8.3"]));
  });
});

describe("matchItem", () => {
  it("scores a direct package's own release feed highest", () => {
    const m = matchItem(
      { title: "v16.4.1", rawText: "" },
      rss("https://github.com/vercel/next.js/releases.atom"),
      stack()
    );
    expect(m).toMatchObject({
      score: SCORES.directRelease,
      reason: "release:next",
      repoIds: ["web"],
    });
  });

  it("scores transitive releases lower", () => {
    const m = matchItem(
      { title: "v1.4.1", rawText: "" },
      rss("https://github.com/zertosh/loose-envify/releases.atom"),
      stack()
    );
    expect(m?.score).toBe(SCORES.transitiveRelease);
  });

  it("matches a monorepo feed to the repos of every package it publishes", () => {
    // W43: the payloadcms/payload feed matched only `@payloadcms/bundler-webpack` (listed
    // first, one repo), so repos installing `payload` were missing from affected_repos.
    const base = stack();
    const pkg = (name: string, repos: string[], direct = true) => ({
      packageId: `pkg_${name}`,
      name,
      direct,
      repoIds: new Set(repos),
      serviceKey: null,
    });
    const feed = "https://github.com/payloadcms/payload/releases.atom";
    const payloadStack: OrgStack = {
      ...base,
      packages: new Map(
        [
          pkg("@payloadcms/bundler-webpack", ["bakery.example"]),
          pkg("@payloadcms/db-sqlite", ["west.garden.example"]),
          pkg("payload", [
            "bakery.example",
            "clinic.example",
            "orchid-hotel",
            "west.garden.example",
          ]),
          pkg("@payloadcms/translations", ["pixel-studio"], false),
        ].map((p) => [p.name, p])
      ),
      packagesByFeed: new Map([
        [
          feed,
          [
            "@payloadcms/bundler-webpack",
            "@payloadcms/db-sqlite",
            "payload",
            "@payloadcms/translations",
          ],
        ],
      ]),
    };
    const m = matchItem({ title: "v3.92.0", rawText: "" }, rss(feed), payloadStack);
    expect(m).toMatchObject({ score: SCORES.directRelease, reason: "release:payload" });
    expect([...(m?.repoIds ?? [])].sort()).toEqual([
      "bakery.example",
      "clinic.example",
      "orchid-hotel",
      "pixel-studio",
      "west.garden.example",
    ]);
  });

  it("names the Go module of a feed's repo across major-version paths", () => {
    const feed = "https://github.com/acme/kit/releases.atom";
    const goPkg = (name: string, repos: string[]) => ({
      packageId: `pkg_${name}`,
      ecosystem: "Go",
      name,
      direct: true,
      repoIds: new Set(repos),
      serviceKey: null,
    });
    const kit = goPkg("github.com/acme/kit/v2", ["acme/jobs"]);
    const plugin = goPkg("github.com/acme/kit-plugins", ["acme/api", "acme/web"]);
    const goStack: OrgStack = {
      ...stack(),
      packages: new Map([
        [stackPackageKey("Go", kit.name), kit],
        [stackPackageKey("Go", plugin.name), plugin],
      ]),
      packagesByFeed: new Map([
        [feed, [stackPackageKey("Go", plugin.name), stackPackageKey("Go", kit.name)]],
      ]),
    };
    const m = matchItem({ title: "v2.5.0", rawText: "" }, rss(feed), goStack);
    expect(m).toMatchObject({ packageId: "pkg_github.com/acme/kit/v2" });
    expect(m?.reason).toBe("release:github.com/acme/kit/v2");
  });

  it("matches service announcements only for orgs using the service", () => {
    const item = { title: "Paywalls v3", rawText: "" };
    expect(matchItem(item, rss("https://rc/blog", "revenuecat"), stack())?.reason).toBe(
      "service:revenuecat"
    );
    expect(matchItem(item, rss("https://expo/blog", "expo"), stack())).toBeNull();
  });

  it("keeps the Vercel blog silent for an org that only uses Next.js", () => {
    const s = stack();
    s.services.set("nextjs", { key: "nextjs", name: "Next.js", repoIds: new Set(["web"]) });
    s.traits.add("nextjs");
    const item = { title: "GPT-6 is now available on Vercel AI Gateway", rawText: "Vercel" };
    expect(matchItem(item, rss("https://vercel.com/atom", "vercel"), s)).toBeNull();
    s.services.set("vercel", { key: "vercel", name: "Vercel", repoIds: new Set(["web"]) });
    expect(matchItem(item, rss("https://vercel.com/atom", "vercel"), s)?.reason).toBe(
      "service:vercel+mention:vercel"
    );
  });

  it("matches platform feeds by trait, and 'always' everywhere", () => {
    const item = { title: "New App Store requirement", rawText: "" };
    expect(matchItem(item, rss("https://apple", null, ["ios"]), stack())?.reason).toBe("trait:ios");
    expect(matchItem(item, rss("https://cc", null, ["always"]), stack())?.score).toBe(SCORES.trait);
    expect(matchItem(item, rss("https://web", null, ["nextjs"]), stack())).toBeNull();
  });

  it("boosts a base match when the text mentions a direct package or service", () => {
    const m = matchItem(
      { title: "Expo SDK 57", rawText: "Upgrade react-native-purchases and RevenueCat paywalls." },
      rss("https://apple", null, ["ios"]),
      stack()
    );
    expect(m?.score).toBeCloseTo(SCORES.trait + SCORES.mentionBoost);
    expect(m?.reason).toMatch(/^trait:ios\+mention:/);
    expect(m?.repoIds).toEqual(["app"]);
  });

  it("matches distinctive direct package mentions on unrelated feeds", () => {
    const m = matchItem(
      { title: "Breaking change in @sentry/react-native 7", rawText: "" },
      rss("https://news"),
      stack()
    );
    expect(m?.reason).toBe("mention:@sentry/react-native");
  });

  it("ignores bare common words and transitive mentions", () => {
    expect(
      matchItem({ title: "What is next for us", rawText: "" }, rss("https://news"), stack())
    ).toBeNull();
    expect(
      matchItem({ title: "loose-envify deep dive", rawText: "" }, rss("https://news"), stack())
    ).toBeNull();
  });
});

describe("tokenize", () => {
  it("keeps package punctuation and trims sentence punctuation", () => {
    expect(tokenize("Use @sentry/react-native, next.js.")).toEqual(
      new Set(["use", "@sentry/react-native", "next.js"])
    );
  });
});
