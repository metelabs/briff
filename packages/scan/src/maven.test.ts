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
