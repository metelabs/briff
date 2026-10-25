import { describe, expect, it } from "vitest";

import { githubReleasesFeedUrl, parseGithubRepo, repoSlugFromFeedUrl } from "./github-releases";

describe("parseGithubRepo", () => {
  it("normalises the repository forms npm packages use", () => {
    const expected = { owner: "vercel", repo: "next.js" };
    expect(parseGithubRepo("git+https://github.com/vercel/next.js.git")).toEqual(expected);
    expect(parseGithubRepo("https://github.com/vercel/next.js")).toEqual(expected);
    expect(parseGithubRepo("git://github.com/vercel/next.js.git")).toEqual(expected);
    expect(parseGithubRepo("git@github.com:vercel/next.js.git")).toEqual(expected);
    expect(parseGithubRepo("ssh://git@github.com/vercel/next.js.git")).toEqual(expected);
    expect(parseGithubRepo("github:vercel/next.js")).toEqual(expected);
    expect(parseGithubRepo("vercel/next.js")).toEqual(expected);
    expect(parseGithubRepo("https://github.com/vercel/next.js/tree/canary/packages/next")).toEqual(
      expected
    );
  });

  it("rejects non-GitHub hosts and junk", () => {
    expect(parseGithubRepo("https://gitlab.com/a/b")).toBeNull();
    expect(parseGithubRepo("http://169.254.169.254/a/b")).toBeNull();
    expect(parseGithubRepo("https://github.com/only-owner")).toBeNull();
    expect(parseGithubRepo("")).toBeNull();
    expect(parseGithubRepo(null)).toBeNull();
  });
});

describe("feed URLs", () => {
  it("builds and reverses releases.atom URLs", () => {
    const url = githubReleasesFeedUrl({ owner: "expo", repo: "expo" });
    expect(url).toBe("https://github.com/expo/expo/releases.atom");
    expect(repoSlugFromFeedUrl(url)).toBe("expo/expo");
  });
});
