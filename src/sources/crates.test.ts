import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { fetchCrate } from "./crates";

const body: unknown = JSON.parse(
  readFileSync(new URL("./__fixtures__/crates.json", import.meta.url), "utf8")
);
afterEach(() => vi.unstubAllGlobals());
it("uses crates.io's latest stable release and sends its required User-Agent", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(body));
  vi.stubGlobal("fetch", fetch);
  expect(await fetchCrate("acme-kit")).toEqual({
    status: "ok",
    info: {
      latestVersion: "1.2.4",
      deprecated: null,
      repositoryUrl: "https://github.com/acme/kit",
      homepage: null,
    },
  });
  expect(fetch.mock.calls[0][1].headers["User-Agent"]).toContain("Briff");
});
it("does not advertise a yanked release as current", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        crate: { max_stable_version: "1.2.4" },
        versions: [{ num: "1.2.4", yanked: true }],
      })
    )
  );
  expect(await fetchCrate("acme-kit")).toMatchObject({
    status: "ok",
    info: { latestVersion: null, deprecated: "All releases are yanked." },
  });
});
