import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCargoLock } from "./cargo-lock";
import { collectFromFiles, collectRepos } from "./collect";

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/cargo/${name}`, import.meta.url), "utf8");
const files = Object.fromEntries(
  ["Cargo.lock", "Cargo.toml", "crates/api/Cargo.toml"].map((name) => [name, fixture(name)])
);

describe("Cargo", () => {
  it.each([3, 4])("reads v%i pins and workspace inherited/renamed declarations", (version) => {
    const rows = parseCargoLock(
      files["Cargo.lock"].replace("version = 4", `version = ${version}`),
      files
    );
    expect(rows).toEqual([
      {
        name: "tokio",
        version: "1.24.1",
        direct: true,
        ecosystem: "crates.io",
        requirement: "1.24.1",
      },
      {
        name: "time",
        version: "0.3.17",
        direct: true,
        dev: true,
        ecosystem: "crates.io",
        requirement: "0.3.17",
      },
      {
        name: "smallvec",
        version: "1.8.0",
        direct: false,
        ecosystem: "crates.io",
        requirement: "1.8.0",
      },
    ]);
  });
  it("uses member manifests in the shared GitHub collector", async () => {
    const payload = await collectFromFiles("acme/api", files, { warn: () => {} });
    expect(payload?.dependencies.find((d) => d.name === "tokio")?.direct).toBe(true);
  });
  it("reads workspace members when scanning a fixture without a git marker", async () => {
    const repos = await collectRepos(
      new URL("./__fixtures__/cargo", import.meta.url).pathname,
      { kind: "all", includeWorktrees: false },
      { warn: () => {} }
    );
    expect(repos[0]?.dependencies.find((d) => d.name === "tokio")?.direct).toBe(true);
  });
  it("keeps another installed release line transitive", () => {
    const lock =
      files["Cargo.lock"].replace('"time"]', '"time 0.3.17"]') +
      '\n[[package]]\nname = "time"\nversion = "0.2.27"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n';
    expect(
      parseCargoLock(lock, files)
        .filter((p) => p.name === "time")
        .map((p) => p.direct)
    ).toEqual([true, false]);
  });
  it("does not query Git dependencies as crates.io packages", () => {
    expect(
      parseCargoLock(
        files["Cargo.lock"].replaceAll(
          "registry+https://github.com/rust-lang/crates.io-index",
          "git+https://github.com/acme/kit"
        ),
        files
      )
    ).toEqual([]);
  });
});
