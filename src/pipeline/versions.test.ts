import { describe, expect, it } from "vitest";

import {
  compareVersions,
  extractVersion,
  isPreRelease,
  isShaTag,
  ruleMinorReason,
} from "./versions";

const BAML_TITLES = [
  "baml-language-source-481d074234fce9df31ee0ab0da5f29c5d5fe1e4d: Deliver owned spans to BCS (#5310)",
  "BoundaryML/baml 481d074234fce9df31ee0ab0da5f29c5d5fe1e4d",
];

describe("isShaTag", () => {
  it.each(BAML_TITLES)("flags %s", (title) => {
    expect(isShaTag(title)).toBe(true);
    expect(ruleMinorReason(title)).toBe("sha-tag");
  });

  it.each([
    "vercel/next.js v16.4.1",
    "baml 0.210.0",
    // 39 and 41 hex characters are not a full sha.
    "build 481d074234fce9df31ee0ab0da5f29c5d5fe1e4",
    "build 481d074234fce9df31ee0ab0da5f29c5d5fe1e4d0",
    "sha 481d074234fce9df31ee0ab0da5f29c5d5fe1e4dz",
  ])("does not flag %s", (title) => {
    expect(isShaTag(title)).toBe(false);
  });

  it("prefers the pre-release reason and leaves real releases to the model", () => {
    expect(ruleMinorReason("vercel/next.js v16.1.0-canary.12")).toBe("pre-release");
    expect(ruleMinorReason("vercel/next.js v16.4.1")).toBeNull();
  });
});

describe("isPreRelease", () => {
  it.each([
    "vercel/next.js v16.1.0-canary.12",
    "expo@55.0.0-beta.3",
    "facebook/react-native v0.83.0-rc.1",
    "prisma 7.2.0-dev.4",
    "react 19.3.0-next.1",
    "swc 1.15.0-nightly-20261019.1",
    "tailwindcss v4.2.0-alpha.1",
    "better-auth v1.4.0-beta",
    "styled-components@7.0.0-prerelease-20261019004440",
    "resend/resend-node v6.32.1-preview-inboxes.6",
    "TypeScript 7.1 Beta",
    "Vite 8.0 RC1",
    "react-native 0.84.0-experimental.2",
    // Accepted false positive: the word rule cannot tell a product name from a marker.
    "Alpha Vantage SDK 2.0.0",
  ])("flags %s", (title) => {
    expect(isPreRelease(title)).toBe(true);
  });

  it.each([
    "vercel/next.js v16.4.1",
    "Next.js 16.5: faster builds",
    "Claude Code 2.1.0",
    "Introducing the beta of Expo Router 5",
    "react-native-purchases 9.6.0",
    "next-auth v5.0.0",
    "Dart Sass 1.106.0",
    "better-auth v1.7.12",
    "Beta program for Expo Router",
    "src 1.2.0",
  ])("does not flag %s", (title) => {
    expect(isPreRelease(title)).toBe(false);
  });
});

describe("extractVersion and compareVersions", () => {
  it("reads the tag after the repo slug", () => {
    expect(extractVersion("vercel/next.js v16.4.1")?.text).toBe("16.4.1");
    expect(extractVersion("expo@55.0.0-beta.3")).toMatchObject({
      parts: [55, 0, 0],
      pre: "beta.3",
    });
    expect(extractVersion("Weekly update")).toBeNull();
  });

  it("orders numerically and puts a release above its pre-releases", () => {
    const v = (t: string) => extractVersion(t)!;
    expect(compareVersions(v("4.10.0"), v("4.9.3"))).toBeGreaterThan(0);
    expect(compareVersions(v("4.29.0"), v("4.29.0-rc.1"))).toBeGreaterThan(0);
    expect(compareVersions(v("1.0.0-rc.10"), v("1.0.0-rc.9"))).toBeGreaterThan(0);
    expect(compareVersions(v("2.1"), v("2.1.0"))).toBe(0);
  });
});
