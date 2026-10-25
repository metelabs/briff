import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  expandMinified,
  packagistResponseSchema,
  packagistUrl,
  toPackagistInfo,
} from "./packagist";

const body = packagistResponseSchema.parse(
  JSON.parse(readFileSync(path.join(__dirname, "__fixtures__", "packagist-p2.json"), "utf8"))
);

describe("packagist adapter", () => {
  it("builds the p2 URL only for names Composer accepts", () => {
    expect(packagistUrl("acme/http-kernel")).toBe(
      "https://repo.packagist.org/p2/acme/http-kernel.json"
    );
    expect(packagistUrl("../etc/passwd")).toBeNull();
    expect(packagistUrl("acme")).toBeNull();
    expect(packagistUrl("Acme/Log")).toBeNull();
  });

  it("expands Composer's minified entries, honouring __unset", () => {
    const entries = expandMinified(body.packages["acme/http-kernel"]);
    expect(entries[1].homepage).toBe("https://acme.example/http-kernel");
    expect(entries[2]).not.toHaveProperty("homepage");
    expect(entries[2].source).toEqual(entries[1].source);
  });

  it("takes the newest stable release and its source repository", () => {
    expect(toPackagistInfo("acme/http-kernel", body)).toEqual({
      latestVersion: "7.1.3",
      deprecated: null,
      repositoryUrl: "https://github.com/acme/http-kernel.git",
      homepage: "https://acme.example/http-kernel",
    });
    expect(toPackagistInfo("acme/other", body)).toBeNull();
  });

  it("reads abandonment as deprecation", () => {
    const abandoned = (value: unknown) =>
      toPackagistInfo("acme/old", {
        packages: {
          "acme/old": [{ version: "1.2.0", version_normalized: "1.2.0.0", abandoned: value }],
        },
      })?.deprecated;
    expect(abandoned(true)).toBe("Abandoned.");
    expect(abandoned("acme/new")).toBe("Abandoned; use acme/new instead.");
    expect(abandoned(false)).toBeNull();
  });
});
