import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { fetchSwiftPackage } from "./swift";
const body: unknown = JSON.parse(
  readFileSync(new URL("./__fixtures__/swift-releases.json", import.meta.url), "utf8")
);
afterEach(() => vi.unstubAllGlobals());
it("uses stable GitHub releases and returns the existing release-feed repository link", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(body));
  vi.stubGlobal("fetch", fetch);
  expect(await fetchSwiftPackage("github.com/acme/kit")).toEqual({
    status: "ok",
    info: {
      latestVersion: "1.2.4",
      deprecated: null,
      repositoryUrl: "https://github.com/acme/kit",
      homepage: "https://github.com/acme/kit",
    },
  });
  expect(fetch.mock.calls[0][0]).toBe(
    "https://api.github.com/repos/acme/kit/releases?per_page=100"
  );
});
it("retains repository links for packages without releases and avoids fetching other hosts", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
  vi.stubGlobal("fetch", fetch);
  expect(await fetchSwiftPackage("github.com/acme/kit")).toMatchObject({
    status: "ok",
    info: { latestVersion: null },
  });
  fetch.mockClear();
  expect(await fetchSwiftPackage("git.example/acme/kit")).toMatchObject({
    status: "ok",
    info: { latestVersion: null, repositoryUrl: "https://git.example/acme/kit" },
  });
  expect(fetch).not.toHaveBeenCalled();
});
