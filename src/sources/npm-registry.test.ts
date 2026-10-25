import { describe, expect, it } from "vitest";

import { npmLatestSchema, npmLatestUrl, toPackageInfo } from "./npm-registry";

describe("npm registry adapter", () => {
  it("escapes scoped names", () => {
    expect(npmLatestUrl("@sentry/node")).toBe("https://registry.npmjs.org/@sentry%2Fnode/latest");
    expect(npmLatestUrl("next")).toBe("https://registry.npmjs.org/next/latest");
  });

  it("extracts version, deprecation and repository", () => {
    const manifest = npmLatestSchema.parse({
      name: "request",
      version: "2.88.2",
      deprecated: "request has been deprecated",
      repository: { type: "git", url: "git+https://github.com/request/request.git" },
    });
    expect(toPackageInfo(manifest)).toEqual({
      latestVersion: "2.88.2",
      deprecated: "request has been deprecated",
      repositoryUrl: "git+https://github.com/request/request.git",
      homepage: null,
    });
  });

  it("accepts string repositories and ignores deprecated=false", () => {
    const info = toPackageInfo(
      npmLatestSchema.parse({ name: "x", version: "1.0.0", deprecated: false, repository: "a/b" })
    );
    expect(info.deprecated).toBeNull();
    expect(info.repositoryUrl).toBe("a/b");
  });
});
