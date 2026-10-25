import { describe, expect, it } from "vitest";

import { repoAliases } from "./pseudonym";

describe("repoAliases", () => {
  it("assigns aliases by code-point order of the distinct names, whatever the input order", () => {
    const a = repoAliases(["pantheon", "garden.example", "pantheon", "Briff"]);
    const b = repoAliases(["garden.example", "Briff", "pantheon"]);
    expect(a.size).toBe(3);
    for (const name of ["Briff", "garden.example", "pantheon"])
      expect(a.alias(name)).toBe(b.alias(name));
    expect([a.alias("Briff"), a.alias("garden.example"), a.alias("pantheon")]).toEqual([
      "repo-1",
      "repo-2",
      "repo-3",
    ]);
    expect(a.alias("unknown")).toBe("unknown");
  });

  it("rewrites names wherever they are not part of a longer word, URLs and paths included", () => {
    const a = repoAliases(["sigma/pantheon", "garden.example", "west.garden.example", "api"]);
    const [p, g, y, api] = ["sigma/pantheon", "garden.example", "west.garden.example", "api"].map(
      a.alias
    );
    expect(
      a.aliasText(
        "Update sigma/pantheon, pantheon, Garden.example and west.garden.example. Not pantheonx"
      )
    ).toBe(`Update ${p}, ${p}, ${g} and ${y}. Not pantheonx`);
    expect(a.aliasText("https://github.com/sigma/pantheon/pulls and garden.example/docs")).toBe(
      `https://github.com/${p}/pulls and ${g}/docs`
    );
    expect(a.aliasText("my-garden.example, pantheon_v2, api")).toBe(`my-${g}, ${p}_v2, ${api}`);
    // A short unambiguous basename is a name too.
    const ui = repoAliases(["acme/ui"]);
    expect(ui.aliasText("Prioritize ui and acme/ui")).toBe("Prioritize repo-1 and repo-1");
  });

  it("round-trips URLs and compounds", () => {
    const a = repoAliases(["acme/private-ledger", "garden.example"]);
    const text = "Focus on https://github.com/acme/private-ledger and my-garden.example/docs.";
    const aliased = a.aliasText(text);
    expect(aliased).not.toMatch(/ledger|garden/);
    expect(a.restoreText(aliased)).toBe(text);
  });

  it("never rewrites a kept name, whole or in part (packages, services)", () => {
    const a = repoAliases(["next", "acme/next", "web"], ["next", "@acme/web-sdk"]);
    expect(a.aliasText("npm i next@16.2.1 @acme/web-sdk@2 in web")).toBe(
      `npm i next@16.2.1 @acme/web-sdk@2 in ${a.alias("web")}`
    );
    expect(a.alias("next")).toBe("repo-2");
  });

  it("redacts a repo name that contains a public name", () => {
    const a = repoAliases(["acme/next-app", "web-sdk-internal"], ["next", "@acme/web-sdk"]);
    const [n, w] = [a.alias("acme/next-app"), a.alias("web-sdk-internal")];
    expect(a.aliasText("Prioritize acme/next-app and next-app; npm i next@16")).toBe(
      `Prioritize ${n} and ${n}; npm i next@16`
    );
    // Overlapping a public name does not protect the private one.
    expect(a.aliasText("@acme/web-sdk-internal and @acme/web-sdk")).toBe(
      `@acme/${w} and @acme/web-sdk`
    );
  });

  it("gives a short name inside a public identifier back unchanged", () => {
    const a = repoAliases(["private/web"]);
    const text = "Prioritize @acme/web-sdk and web";
    expect(a.restoreText(a.aliasText(text))).toBe(text);
  });

  it("never restores inside a public name that contains an alias", () => {
    const a = repoAliases(["billing"], ["@acme/repo-1"]);
    expect(a.restoreText("npm i @acme/repo-1@2.0.0 in repo-1")).toBe(
      "npm i @acme/repo-1@2.0.0 in billing"
    );
  });

  it("never hands out an alias the request already contains", () => {
    const text = "Read https://example.com/repo-1/migration about billing";
    const a = repoAliases(["billing"], [], { avoidIn: text });
    expect(a.alias("billing")).toBe("repo-2");
    const aliased = a.aliasText(text);
    expect(aliased).toBe("Read https://example.com/repo-1/migration about repo-2");
    expect(a.restoreText(aliased)).toBe(text);
  });

  it("does not use a last segment two repos share", () => {
    const a = repoAliases(["a/site", "b/site"]);
    expect(a.aliasText("site and a/site")).toBe(`site and ${a.alias("a/site")}`);
  });

  it("restores whole-token aliases, any case, and leaves unknown ones", () => {
    const a = repoAliases(["garden.example", "pantheon"]);
    expect(a.restoreText("Repo-1 and repo-2. repo-3, repo-10, repo-1x, my-repo-1")).toBe(
      "garden.example and pantheon. repo-3, repo-10, repo-1x, my-garden.example"
    );
  });

  it("round-trips text", () => {
    const names = ["sigma/tracker", "garden.example", "clinic.example"];
    const a = repoAliases(names);
    const text = "Move tracker, garden.example and clinic.example to node 22.23.4.";
    const aliased = a.aliasText(text);
    for (const n of ["tracker", "garden.example", "clinic.example"])
      expect(aliased).not.toContain(n);
    // Each alias replaced one spelling only, so the text comes back exactly.
    expect(a.restoreText(aliased)).toBe(text);
    // A spelling used in a structured field as well restores as the full name.
    a.alias("sigma/tracker");
    expect(a.restoreText(aliased)).toBe(
      "Move sigma/tracker, garden.example and clinic.example to node 22.23.4."
    );
  });
});
