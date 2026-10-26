import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";

import { fetchRubyGemsPackage, rubyGemsSchema, toRubyGemsInfo } from "./rubygems";

const body: unknown = JSON.parse(
  readFileSync(new URL("./__fixtures__/rubygems.json", import.meta.url), "utf8")
);
afterEach(() => vi.unstubAllGlobals());

it("uses the latest non-yanked version and the published source repository", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json(body))
    .mockResolvedValueOnce(Response.json({ version: "1.2.4" }));
  vi.stubGlobal("fetch", fetch);
  expect(await fetchRubyGemsPackage("acme-kit")).toEqual({
    status: "ok",
    info: {
      latestVersion: "1.2.4",
      deprecated: null,
      repositoryUrl: "https://github.com/acme/kit",
      homepage: "https://kit.example",
    },
  });
  expect(fetch.mock.calls.map((call) => call[0])).toEqual([
    "https://rubygems.org/api/v1/gems/acme-kit.json",
    "https://rubygems.org/api/v1/versions/acme-kit/latest.json",
  ]);
});
it("rejects unsafe names without making a request", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(await fetchRubyGemsPackage("../acme")).toEqual({ status: "not_found" });
  expect(fetch).not.toHaveBeenCalled();
});
it("keeps the registry version separate from the latest endpoint", () => {
  expect(toRubyGemsInfo(rubyGemsSchema.parse(body), "1.2.4").latestVersion).toBe("1.2.4");
});

it("falls back to metadata when the top-level source link is empty", () => {
  expect(
    toRubyGemsInfo(
      {
        version: "1.2.3",
        source_code_uri: "",
        metadata: { source_code_uri: "https://github.com/acme/kit" },
      },
      "1.2.4"
    ).repositoryUrl
  ).toBe("https://github.com/acme/kit");
});
