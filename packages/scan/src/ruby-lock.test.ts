import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { collectFromFiles } from "./collect";
import { isScannedPath } from "./files";
import { parseRubyLock, rubyDevGems } from "./ruby-lock";

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/rubygems/${name}`, import.meta.url), "utf8");

describe("Bundler", () => {
  it("collapses platform pins and uses DEPENDENCIES for direct declarations", () => {
    expect(parseRubyLock(fixture("Gemfile.lock"), fixture("Gemfile"))).toEqual([
      { name: "mini_portile2", version: "2.8.0", direct: false, ecosystem: "RubyGems" },
      { name: "nokogiri", version: "1.13.9", direct: true, ecosystem: "RubyGems", dev: true },
      { name: "rack", version: "2.2.3", direct: true, ecosystem: "RubyGems" },
    ]);
  });
  it("does not mark a production declaration as development only", () => {
    expect(rubyDevGems('gem "rack"\ngroup :test do\n gem "rack"\nend').has("rack")).toBe(false);
  });
  it("does not treat path or Git sources as registry packages", () => {
    expect(parseRubyLock("GIT\n  specs:\n    acme-kit (1.0.0)\nDEPENDENCIES\n  acme-kit!")).toEqual(
      []
    );
  });
  it("fetches manifests through the GitHub App filter and the shared collector", async () => {
    expect(isScannedPath("apps/api/Gemfile")).toBe(true);
    expect(isScannedPath("apps/api/Gemfile.lock")).toBe(true);
    expect(isScannedPath("vendor/Gemfile.lock")).toBe(false);
    const payload = await collectFromFiles(
      "acme/api",
      { "Gemfile.lock": fixture("Gemfile.lock"), Gemfile: fixture("Gemfile") },
      { warn: () => {} }
    );
    expect(payload?.dependencies.find((d) => d.name === "nokogiri")?.dev).toBe(true);
  });
});
