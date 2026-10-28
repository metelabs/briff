import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { fetchNugetPackage } from "./nuget";
const fixture = (file: string) =>
  readFileSync(new URL(`./__fixtures__/${file}`, import.meta.url), "utf8");
afterEach(() => vi.unstubAllGlobals());
it("reads paginated registrations, excludes unlisted/prereleases and reads nuspec repository", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(fixture("nuget-registration.json")))
    .mockResolvedValueOnce(new Response(fixture("nuget-versions.json")))
    .mockResolvedValueOnce(new Response(fixture("nuget-page.json")))
    .mockResolvedValueOnce(new Response(fixture("nuget.nuspec")));
  vi.stubGlobal("fetch", fetch);
  expect(await fetchNugetPackage("Acme.Kit")).toEqual({
    status: "ok",
    info: {
      latestVersion: "1.2.3",
      deprecated: "Use the maintained package.",
      repositoryUrl: "https://github.com/acme/kit",
      homepage: "https://github.com/acme/kit",
    },
  });
  expect(fetch.mock.calls[0][0]).toBe(
    "https://api.nuget.org/v3/registration5-gz-semver2/acme.kit/index.json"
  );
});
it("returns not found for missing packages", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
  expect(await fetchNugetPackage("acme.absent")).toEqual({ status: "not_found" });
});

it("orders listed four-part NuGet versions without semver coercion", async () => {
  const recorded = JSON.parse(fixture("nuget-page.json")) as {
    items: { catalogEntry: { version: string; listed: boolean } }[];
  };
  recorded.items[0].catalogEntry.version = "1.2.3.4";
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ items: [recorded] }))
    .mockResolvedValueOnce(Response.json({ versions: ["1.2.3.4", "1.2.4", "2.0.0-beta.1"] }))
    .mockResolvedValueOnce(new Response(fixture("nuget.nuspec")));
  vi.stubGlobal("fetch", fetch);
  const result = await fetchNugetPackage("acme.kit");
  expect(result.status === "ok" && result.info.latestVersion).toBe("1.2.3.4");
});
