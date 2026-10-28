import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { collectRepos, collectFromFiles } from "./collect";
import { parseNugetFiles } from "./nuget";
export const fixtureFiles = Object.fromEntries(
  [
    "Directory.Packages.props",
    "api/Acme.Api.csproj",
    "locked/Acme.Worker.csproj",
    "locked/packages.lock.json",
  ].map((file) => [
    file,
    readFileSync(new URL(`./__fixtures__/nuget/${file}`, import.meta.url), "utf8"),
  ])
);
describe("NuGet", () => {
  it("retains central fallbacks for conditional children and replaces unconditional properties", () => {
    const files = Object.fromEntries(
      ["Acme.csproj", "Directory.Packages.props"].map((file) => [
        file,
        readFileSync(new URL(`./__fixtures__/nuget-fallback/${file}`, import.meta.url), "utf8"),
      ])
    );
    expect(parseNugetFiles(files).map((dep) => [dep.name, dep.version])).toEqual([
      ["system.text.json", "8.0.5"],
      ["system.text.encodings.web", "9.0.0"],
      ["system.text.encodings.web", "8.0.1"],
      ["acme.child", "9.0.0"],
      ["acme.child", "8.0.0"],
    ]);
  });
  it("retains conditional project and central property alternatives", () => {
    const files = Object.fromEntries(
      ["Acme.csproj", "Directory.Packages.props"].map((file) => [
        file,
        readFileSync(new URL(`./__fixtures__/nuget-properties/${file}`, import.meta.url), "utf8"),
      ])
    );
    expect(parseNugetFiles(files).map((dep) => [dep.name, dep.version])).toEqual([
      ["system.text.json", "8.0.0"],
      ["system.text.json", "9.0.0"],
      ["system.text.encodings.web", "8.0.0"],
      ["system.text.encodings.web", "9.0.0"],
      ["acme.child", "8.0.0"],
      ["acme.child", "9.0.0"],
      ["acme.override", "8.0.0"],
      ["acme.override", "9.0.0"],
    ]);
  });
  it("detects differing lock pins while handling a many-project solution", () => {
    const files = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [
        `app${i}/packages.lock.json`,
        JSON.stringify({
          dependencies: {
            net8: Object.fromEntries(
              Array.from({ length: 100 }, (_, j) => [
                `Acme.Package${j}`,
                { type: "Direct", resolved: "1.0.0" },
              ])
            ),
          },
        }),
      ])
    );
    const rows = parseNugetFiles(files);
    expect(rows).toHaveLength(4000);
    expect(rows.every((row) => row.requirement === undefined)).toBe(true);
    expect(
      parseNugetFiles({
        "packages.lock.json": JSON.stringify({
          dependencies: {
            net8: { "Acme.Kit": { type: "Direct", resolved: "8.0.0" } },
            net9: { "Acme.Kit": { type: "Direct", resolved: "9.0.0" } },
          },
        }),
      }).every((row) => row.requirement === "nuget-conditional")
    ).toBe(true);
  });
  it("preserves conditional central version alternatives and explicit overrides", () => {
    const files = Object.fromEntries(
      ["Acme.csproj", "Directory.Packages.props"].map((file) => [
        file,
        readFileSync(new URL(`./__fixtures__/nuget-conditional/${file}`, import.meta.url), "utf8"),
      ])
    );
    const rows = parseNugetFiles(files);
    expect(rows.every((dep) => dep.requirement === "nuget-conditional")).toBe(true);
    expect(rows.map((dep) => [dep.name, dep.version])).toEqual([
      ["system.text.json", "8.0.0"],
      ["system.text.json", "9.0.0"],
      ["acme.override", "1.2.3"],
    ]);
  });
  it("keeps fix ownership on direct projects when another project has the same pin transitively", async () => {
    const repo = await collectFromFiles(
      "acme/nuget",
      {
        ...fixtureFiles,
        "locked/packages.lock.json": fixtureFiles["locked/packages.lock.json"].replaceAll(
          '"Direct"',
          '"Transitive"'
        ),
      },
      { warn: () => {} }
    );
    expect(repo?.dependencies.find((d) => d.name === "newtonsoft.json")?.project).toBe(
      "api/Acme.Api.csproj"
    );
  });

  it("isolates local project groups while reading central files from ancestors", async () => {
    const repos = await collectRepos(
      fileURLToPath(new URL("./__fixtures__/nuget", import.meta.url)),
      { kind: "all", includeWorktrees: false },
      {
        warn: (message) => {
          throw new Error(message);
        },
      }
    );
    expect(
      repos.map((repo) => [repo.name, repo.dependencies.map((d) => [d.name, d.project])])
    ).toEqual([
      [
        "api",
        [
          ["newtonsoft.json", "Acme.Api.csproj"],
          ["system.text.encodings.web", "Acme.Api.csproj"],
        ],
      ],
      [
        "locked",
        [
          ["newtonsoft.json", "Acme.Worker.csproj"],
          ["system.net.http", "Acme.Worker.csproj"],
        ],
      ],
    ]);
  });

  it("prefers locks and resolves central versions and overrides without installing unused entries", async () => {
    const repo = await collectFromFiles("acme/nuget", fixtureFiles, {
      warn: (message) => {
        throw new Error(message);
      },
    });
    expect(repo?.dependencies.map((d) => [d.name, d.version, d.direct, d.project])).toEqual([
      ["newtonsoft.json", "12.0.1", true, "locked/Acme.Worker.csproj,api/Acme.Api.csproj"],
      ["system.net.http", "4.3.0", false, "locked/Acme.Worker.csproj"],
      ["system.text.encodings.web", "4.5.1", true, "api/Acme.Api.csproj"],
    ]);
  });
  it("uses the nearest central file and project property overrides", () => {
    const rows = parseNugetFiles({
      ...fixtureFiles,
      "api/Directory.Packages.props":
        '<Project><PropertyGroup><ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally></PropertyGroup><ItemGroup><PackageVersion Include="Newtonsoft.Json" Version="13.0.1"/></ItemGroup></Project>',
    });
    expect(
      rows.find((d) => d.project === "api/Acme.Api.csproj" && d.name === "newtonsoft.json")?.version
    ).toBe("13.0.1");
  });
  it("isolates invalid manifests and reports incomplete scans", () => {
    const warnings: string[] = [];
    const rows = parseNugetFiles(
      { ...fixtureFiles, "broken/Acme.csproj": "<Project>", "bad/packages.lock.json": "{" },
      (message) => warnings.push(message)
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(warnings).toHaveLength(2);
  });
  it("reads literal and child-element versions while ignoring project references", () => {
    expect(
      parseNugetFiles({
        "Acme.csproj":
          '<Project><PropertyGroup><VersionPin>1.2.3</VersionPin></PropertyGroup><ItemGroup><PackageReference Include="Acme.Kit"><Version>$(VersionPin)</Version></PackageReference><PackageReference Include="Acme.Exact" Version="[2.0.1]"/><ProjectReference Include="Other.csproj"/></ItemGroup></Project>',
      }).map((d) => [d.name, d.version])
    ).toEqual([
      ["acme.kit", "1.2.3"],
      ["acme.exact", "2.0.1"],
    ]);
  });
});
