import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { fetchPubPackage } from "./pub";
const body: unknown = JSON.parse(
  readFileSync(new URL("./__fixtures__/pub.json", import.meta.url), "utf8")
);
afterEach(() => vi.unstubAllGlobals());
it("refreshes pub metadata and discontinued status from the recorded response", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(body));
  vi.stubGlobal("fetch", fetch);
  expect(await fetchPubPackage("acme_kit")).toEqual({
    status: "ok",
    info: {
      latestVersion: "1.2.4",
      deprecated: "This package is discontinued.",
      repositoryUrl: "https://github.com/acme/kit",
      homepage: "https://example.com",
    },
  });
  expect(fetch.mock.calls[0][0]).toBe("https://pub.dev/api/packages/acme_kit");
});
it("handles missing packages", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
  expect(await fetchPubPackage("acme_missing")).toEqual({ status: "not_found" });
});

it("does not recommend a retracted latest release", async () => {
  const retracted: unknown = JSON.parse(
    readFileSync(new URL("./__fixtures__/pub-retracted.json", import.meta.url), "utf8")
  );
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(retracted)));
  expect(await fetchPubPackage("acme_kit")).toMatchObject({
    status: "ok",
    info: { latestVersion: null },
  });
});
