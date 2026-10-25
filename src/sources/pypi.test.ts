import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { pypiResponseSchema, pypiUrl, toPypiInfo } from "./pypi";

const body = pypiResponseSchema.parse(
  JSON.parse(readFileSync(path.join(__dirname, "__fixtures__", "pypi-json.json"), "utf8"))
);

describe("pypi adapter", () => {
  it("builds the JSON API URL only for PEP 503 names", () => {
    expect(pypiUrl("acme-http")).toBe("https://pypi.org/pypi/acme-http/json");
    expect(pypiUrl("../simple")).toBeNull();
    expect(pypiUrl("Acme_HTTP")).toBeNull();
  });

  it("reads the latest version, the GitHub repository among the project URLs and the homepage", () => {
    expect(toPypiInfo(body)).toEqual({
      latestVersion: "2.32.0",
      deprecated: null,
      repositoryUrl: "https://github.com/acme/acme-http",
      homepage: "https://acme-http.example",
    });
  });

  it("reads an inactive project as deprecated and keeps a non-GitHub source link", () => {
    const info = toPypiInfo({
      info: {
        version: "1.0",
        classifiers: ["Development Status :: 7 - Inactive"],
        project_urls: { Repository: "https://git.example/acme/old" },
      },
    });
    expect(info.deprecated).toMatch(/inactive/i);
    expect(info.repositoryUrl).toBe("https://git.example/acme/old");
  });
});
