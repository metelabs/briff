import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { collectFromFiles } from "./collect";
import { parseMavenFiles } from "./maven";

const files = Object.fromEntries(
  [
    "pom.xml",
    "api/pom.xml",
    "gradle/build.gradle.kts",
    "gradle/gradle.lockfile",
    "gradle/gradle/libs.versions.toml",
  ].map((name) => [
    name,
    readFileSync(new URL(`./__fixtures__/maven/${name}`, import.meta.url), "utf8"),
  ])
);

describe("Maven and Gradle", () => {
  it("resolves directory parents and separates Gradle artifact qualifiers from versions", () => {
    const fixture = (name: string) =>
      readFileSync(new URL(`./__fixtures__/maven-inherited/${name}`, import.meta.url), "utf8");
    const rows = parseMavenFiles({
      "directory-parent/pom.xml": fixture("pom.xml"),
      "child/pom.xml": fixture("directory-parent.xml"),
      "build.gradle.kts": fixture("qualified.gradle.kts"),
    });
    expect(rows.map((row) => [row.name, row.version, row.project])).toEqual([
      ["org.acme:kit", "1.2.4", "directory-parent/pom.xml"],
      ["org.acme:kit", "1.2.4", "child/pom.xml"],
      ["org.acme:kit", "1.2.3", "build.gradle.kts"],
      ["org.acme:other", "1.2.4", "build.gradle.kts"],
      ["org.acme:both", "1.2.5", "build.gradle.kts"],
    ]);
  });
  it("resolves CI-friendly parents and parent aliases independently of the child version", () => {
    const fixture = (name: string) =>
      readFileSync(new URL(`./__fixtures__/maven-inherited/${name}`, import.meta.url), "utf8");
    const rows = parseMavenFiles({
      "pom.xml": fixture("revision.xml"),
      "child/pom.xml": fixture("parent-aliases.xml"),
    });
    expect(rows.map((row) => [row.name, row.version])).toEqual([
      ["org.acme:kit", "1.2.3"],
      ["org.acme:alias", "1.2.3"],
      ["org.acme:pom-alias", "1.2.3"],
    ]);
  });
  it("keeps managed versions separate by type and classifier", () => {
    const pom = readFileSync(
      new URL("./__fixtures__/maven-inherited/classifiers.xml", import.meta.url),
      "utf8"
    );
    expect(parseMavenFiles({ "pom.xml": pom }).map((row) => row.version)).toEqual([
      "1.2.3",
      "1.2.4",
      "1.2.5",
    ]);
  });
  it("evaluates inherited dependencies with child properties and isolates malformed modules", () => {
    const fixture = (file: string) =>
      readFileSync(new URL(`./__fixtures__/maven-inherited/${file}`, import.meta.url), "utf8");
    const rows = parseMavenFiles({
      "pom.xml": fixture("pom.xml"),
      "child/pom.xml": fixture("child/pom.xml"),
      "broken/pom.xml": fixture("broken.xml"),
      "build.gradle.kts": fixture("build.gradle.kts"),
    });
    expect(rows.map((d) => [d.name, d.version, d.project])).toEqual([
      ["org.acme:kit", "1.2.4", "pom.xml"],
      ["org.acme:kit", "1.2.3", "child/pom.xml"],
      ["org.acme:used", "1.2.3", "build.gradle.kts"],
    ]);
  });
  it("warns collection about a malformed module while collecting valid projects", async () => {
    const fixture = (file: string) =>
      readFileSync(new URL(`./__fixtures__/maven-inherited/${file}`, import.meta.url), "utf8");
    const warnings: string[] = [];
    const repo = await collectFromFiles(
      "acme/service",
      {
        "pom.xml": fixture("pom.xml"),
        "broken/pom.xml": fixture("broken.xml"),
        "build.gradle.kts": fixture("build.gradle.kts"),
      },
      { warn: (message) => warnings.push(message) }
    );
    expect(repo?.dependencies.map((d) => d.name).sort()).toEqual(["org.acme:kit", "org.acme:used"]);
    expect(warnings.some((message) => message.includes("broken/pom.xml"))).toBe(true);
  });
  it("rejects unrelated local parents and isolates invalid catalogs", () => {
    const fixture = (file: string) =>
      readFileSync(new URL(`./__fixtures__/maven-inherited/${file}`, import.meta.url), "utf8");
    const warnings: string[] = [];
    const rows = parseMavenFiles(
      {
        "pom.xml": fixture("pom.xml"),
        "module/pom.xml": fixture("external.xml"),
        "build.gradle.kts": fixture("build.gradle.kts"),
        "gradle/libs.versions.toml": fixture("broken.toml"),
      },
      (message) => warnings.push(message)
    );
    expect(rows.map((d) => [d.name, d.project])).toEqual([
      ["org.acme:kit", "pom.xml"],
      ["org.acme:local", "module/pom.xml"],
      ["org.acme:used", "build.gradle.kts"],
    ]);
    expect(warnings).toContain("skip gradle/libs.versions.toml: invalid version catalog");
  });
  it("keeps versionless catalog ownership and literals outside partial locks", () => {
    const partial = Object.fromEntries(
      ["build.gradle.kts", "gradle/libs.versions.toml", "gradle.lockfile"].map((file) => [
        file,
        readFileSync(new URL(`./__fixtures__/maven-partial/${file}`, import.meta.url), "utf8"),
      ])
    );
    expect(parseMavenFiles(partial).map((d) => [d.name, d.version, d.direct, d.project])).toEqual([
      ["org.acme:kit", "1.2.4", true, "gradle/libs.versions.toml"],
      ["org.acme:unlocked", "1.2.3", true, "build.gradle.kts"],
    ]);
  });
  it("resolves inherited management against child overrides", () => {
    const child = readFileSync(
      new URL("./__fixtures__/maven/overrides/pom.xml", import.meta.url),
      "utf8"
    );
    expect(
      parseMavenFiles({ "pom.xml": files["pom.xml"], "overrides/pom.xml": child })[0].version
    ).toBe("2.14.0");
  });
  it("uses locks for versionless declarations and ignores unused constraints", () => {
    const build = readFileSync(
      new URL("./__fixtures__/maven/gradle/versionless.gradle.kts", import.meta.url),
      "utf8"
    );
    expect(parseMavenFiles({ "build.gradle.kts": build })).toEqual([]);
    const rows = parseMavenFiles({
      "build.gradle.kts": build,
      "gradle.lockfile": files["gradle/gradle.lockfile"],
    });
    expect(rows.find((d) => d.name === "org.apache.logging.log4j:log4j-core")).toMatchObject({
      direct: true,
      project: "build.gradle.kts",
      version: "2.14.1",
    });
    expect(rows.some((d) => d.name === "org.acme:unused")).toBe(false);
  });
  it("resolves parent properties and dependency management without installing unused managed packages", () => {
    const rows = parseMavenFiles({
      "pom.xml": files["pom.xml"],
      "api/pom.xml": files["api/pom.xml"],
    });
    expect(rows.map((d) => [d.name, d.version, d.direct, d.dev])).toEqual([
      ["org.apache.logging.log4j:log4j-core", "2.14.1", true, undefined],
      ["org.yaml:snakeyaml", "1.30", true, true],
    ]);
    expect(rows[0].project).toBe("api/pom.xml");
  });
  it("uses lock pins for Gradle and retains transitives", () => {
    const rows = parseMavenFiles(files).filter((d) => d.manager === "gradle");
    expect(rows.map((d) => [d.name, d.version, d.direct])).toEqual([
      ["org.apache.logging.log4j:log4j-core", "2.14.1", true],
      ["org.yaml:snakeyaml", "1.30", true],
      ["commons-collections:commons-collections", "3.2.1", false],
    ]);
  });
  it("falls back to literals and catalog pins without a lockfile", () => {
    expect(parseMavenFiles({ "build.gradle.kts": files["gradle/build.gradle.kts"] })).toHaveLength(
      2
    );
    expect(
      parseMavenFiles({
        "gradle/libs.versions.toml": files["gradle/gradle/libs.versions.toml"],
        "build.gradle.kts": "dependencies { implementation(libs.log4j) }",
      })[0].version
    ).toBe("2.14.1");
  });
  it("does not treat unused catalog entries as installed dependencies", () => {
    expect(
      parseMavenFiles({ "gradle/libs.versions.toml": files["gradle/gradle/libs.versions.toml"] })
    ).toEqual([]);
  });
  it("keeps an unlocked subproject's literal dependencies beside root locks", () => {
    const rows = parseMavenFiles({
      "gradle.lockfile": files["gradle/gradle.lockfile"],
      "api/build.gradle.kts": files["gradle/build.gradle.kts"],
    });
    expect(
      rows.find((d) => d.project === "api/build.gradle.kts" && d.name === "org.yaml:snakeyaml")
        ?.direct
    ).toBe(true);
    expect(rows.filter((d) => d.project === "gradle.lockfile").every((d) => !d.direct)).toBe(true);
  });
  it("skips unresolved properties and dynamic versions", () => {
    expect(
      parseMavenFiles({
        "pom.xml": files["api/pom.xml"].replace("1.30", "${unknown}"),
        "build.gradle": 'implementation("org.acme:kit:1.+")',
      })
    ).toEqual([]);
  });
  it("collects the same Maven dependencies through the GitHub path", async () => {
    const result = await collectFromFiles("acme/service", files, { warn: () => {} });
    expect(result?.dependencies.every((d) => d.ecosystem === "Maven")).toBe(true);
    expect(
      result?.dependencies.some(
        (d) => d.name === "commons-collections:commons-collections" && !d.direct
      )
    ).toBe(true);
  });
});
