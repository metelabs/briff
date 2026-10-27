import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { fetchMavenPackage } from "./maven";
const fixture = (file: string) =>
  readFileSync(new URL(`./__fixtures__/${file}`, import.meta.url), "utf8");
afterEach(() => vi.unstubAllGlobals());
it("reads Maven Central metadata and the POM's repository link", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(fixture("maven.json")))
    .mockResolvedValueOnce(new Response(fixture("maven.pom.xml")));
  vi.stubGlobal("fetch", fetch);
  expect(await fetchMavenPackage("org.acme:kit")).toEqual({
    status: "ok",
    info: {
      latestVersion: "1.2.4",
      deprecated: null,
      repositoryUrl: "https://github.com/acme/kit",
      homepage: null,
    },
  });
  expect(fetch.mock.calls[0][0]).toContain("search.maven.org/solrsearch");
  expect(fetch.mock.calls[1][0]).toBe(
    "https://repo.maven.apache.org/maven2/org/acme/kit/1.2.4/kit-1.2.4.pom"
  );
});
it("treats empty search results as missing", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ response: { docs: [] } })));
  expect(await fetchMavenPackage("org.acme:absent")).toEqual({ status: "not_found" });
});
