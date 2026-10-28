import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { fetchRegistryPackage } from "./registries";
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8"));
afterEach(() => vi.unstubAllGlobals());
it("selects stable nonretired Hex releases and attaches the repository feed link", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(fixture("hex.json")));
  vi.stubGlobal("fetch", fetch);
  expect(await fetchRegistryPackage("Hex", "acme_kit")).toEqual({
    status: "ok",
    info: {
      latestVersion: "1.2.4",
      deprecated: null,
      repositoryUrl: "https://github.com/acme/kit",
      homepage: "https://example.com",
    },
  });
  expect(fetch.mock.calls[0][0]).toBe("https://hex.pm/api/packages/acme_kit");
});
it("reports retirement when every stable release is retired", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(fixture("hex-retired.json"))));
  expect(await fetchRegistryPackage("Hex", "acme_kit")).toMatchObject({
    status: "ok",
    info: {
      latestVersion: null,
      deprecated: "All stable releases are retired.",
    },
  });
});
it("handles missing and invalid public package names", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
  vi.stubGlobal("fetch", fetch);
  expect(await fetchRegistryPackage("Hex", "../private")).toEqual({ status: "not_found" });
  expect(fetch).not.toHaveBeenCalled();
  expect(await fetchRegistryPackage("Hex", "acme_missing")).toEqual({ status: "not_found" });
});
