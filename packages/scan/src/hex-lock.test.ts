import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { collectFromFiles } from "./collect";
import { parseHexLock } from "./hex-lock";
const fixture = (path: string) =>
  readFileSync(new URL(`./__fixtures__/${path}`, import.meta.url), "utf8");
it("reads public Hex pins and literal direct/dev declarations without executing Mix", async () => {
  const repo = await collectFromFiles(
    "acme/elixir",
    {
      "mix.lock": fixture("hex/mix.lock"),
      "mix.exs": fixture("hex/mix.exs"),
    },
    {
      warn: (message) => {
        throw new Error(message);
      },
    }
  );
  expect(repo?.dependencies).toEqual([
    {
      name: "phoenix_html",
      version: "2.14.0",
      direct: true,
      ecosystem: "Hex",
      dev: true,
      project: "mix.exs:phoenix_html",
    },
    { name: "plug", version: "1.10.0", direct: true, ecosystem: "Hex", project: "mix.exs:plug" },
    { name: "plug_crypto", version: "1.0.0", direct: false, ecosystem: "Hex" },
  ]);
});
it("resolves umbrella aliases to the member manifests that own the dependency", async () => {
  const paths = ["mix.lock", "mix.exs", "apps/web/mix.exs", "apps/tools/mix.exs"];
  const files = Object.fromEntries(paths.map((path) => [path, fixture(`hex-umbrella/${path}`)]));
  const repo = await collectFromFiles("acme/umbrella", files, {
    warn: (message) => {
      throw new Error(message);
    },
  });
  expect(repo?.dependencies.find((dep) => dep.name === "plug")).toMatchObject({
    direct: true,
    project: "apps/web/mix.exs:acme_http",
  });
  expect(repo?.dependencies.find((dep) => dep.name === "phoenix_html")).toMatchObject({
    direct: true,
    dev: true,
    project: "apps/tools/mix.exs:phoenix_html",
  });
});
it("keeps pins transitive without a readable manifest and never treats Git locks as Hex", () => {
  expect(parseHexLock(fixture("hex/mix.lock"), {}).every((dep) => !dep.direct)).toBe(true);
  expect(parseHexLock(fixture("hex/mix.lock"), {})).toHaveLength(3);
});

it.each([1, 10, 100])("retains public Hex pins when a Git lock records depth %s", (depth) => {
  const lock = fixture("hex/mix.lock").replace("depth: 100", `depth: ${depth}`);
  expect(parseHexLock(lock, { "mix.exs": fixture("hex/mix.exs") }).map((dep) => dep.name)).toEqual([
    "plug",
    "phoenix_html",
    "plug_crypto",
  ]);
});

it("retains locked advisory evidence when manifest declarations are computed", () => {
  const rows = parseHexLock(fixture("hex/mix.lock"), { "mix.exs": fixture("hex-dynamic/mix.exs") });
  expect(rows).toHaveLength(3);
  expect(rows.every((dep) => !dep.direct)).toBe(true);
});
