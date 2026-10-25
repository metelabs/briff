import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseGoMod } from "./go-mod";

const fixture = (name: string) => readFileSync(path.join(__dirname, "__fixtures__", name), "utf8");

describe("parseGoMod", () => {
  const deps = parseGoMod(fixture("go-app.mod"));
  const brief = deps.map((d) => `${d.name} ${d.version}${d.direct ? " direct" : ""}`);

  it("reads require lines and blocks, direct unless // indirect, versions without the v", () => {
    expect(brief).toEqual([
      "github.com/acme/kit/v2 2.4.1 direct",
      "github.com/acme/queue 1.9.0 direct",
      "golang.org/x/net 0.30.0 direct",
      "gopkg.in/acme/yaml.v3 3.0.1",
      "github.com/acme/retry 0.0.0-20240611120000-0123456789ab",
      "github.com/Acme/Legacy 1.2.0+incompatible",
      "github.com/acme-mirror/forked 1.0.3 direct",
      "golang.org/x/text 0.19.0",
      "github.com/acme/single 1.0.0 direct",
    ]);
    expect(deps.every((d) => d.ecosystem === "Go")).toBe(true);
  });

  it("follows a replacement by another module and skips a local directory", () => {
    expect(brief).not.toContain("github.com/acme/forked 1.0.0 direct");
    expect(deps.find((d) => d.name === "github.com/acme/local")).toBeUndefined();
    // A version-specific replace applies only to that version.
    expect(deps.find((d) => d.name === "golang.org/x/text")?.version).toBe("0.19.0");
  });

  it("records the replaced module and prefers a replacement of the exact version", () => {
    expect(deps.find((d) => d.name === "github.com/acme-mirror/forked")?.requirement).toBe(
      "github.com/acme/forked"
    );
    const mod = [
      "module x",
      "require example.com/lib v1.0.0",
      "replace example.com/lib => example.com/fallback v1.1.0",
      "replace example.com/lib v1.0.0 => example.com/specific v1.2.0",
    ].join("\n");
    expect(parseGoMod(mod)).toEqual([
      {
        name: "example.com/specific",
        version: "1.2.0",
        direct: true,
        ecosystem: "Go",
        requirement: "example.com/lib@v1.0.0",
      },
    ]);
  });

  it("reads quoted paths and ignores a go.mod without requirements", () => {
    expect(parseGoMod('module x\n\nrequire "github.com/acme/q" v1.0.0\n')).toEqual([
      { name: "github.com/acme/q", version: "1.0.0", direct: true, ecosystem: "Go" },
    ]);
    expect(parseGoMod("module x\n\ngo 1.22\n")).toEqual([]);
  });
});
