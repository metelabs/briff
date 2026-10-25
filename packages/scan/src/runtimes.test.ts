import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  imageRepository,
  imageRuntime,
  isConstraintRow,
  isVersionConstraint,
  mergeRuntimes,
  normalizeVersion,
  parseRuntimeFile,
  runtimeEvidence,
  runtimeFileKind,
  tagVersion,
} from "./runtimes";
import type { DetectedRuntime } from "./types";

const fixture = (name: string) =>
  readFileSync(path.join(__dirname, "__fixtures__", "runtimes", name), "utf8");

function parse(name: string): DetectedRuntime[] {
  const kind = runtimeFileKind(name);
  if (!kind) throw new Error(`no runtime parser for ${name}`);
  return parseRuntimeFile(kind, fixture(name), name);
}

/** `name version (normalized) · source`, compact enough to compare whole files at once. */
const brief = (list: DetectedRuntime[]) =>
  list.map(
    (r) =>
      `${r.name} ${r.version} (${r.normalized ?? "-"})${r.unresolved ? " ?" : ""} · ${r.source}`
  );

describe("runtimeFileKind", () => {
  it("recognises version files, manifests, Dockerfiles and compose files", () => {
    expect(runtimeFileKind(".nvmrc")).toBe("nvmrc");
    expect(runtimeFileKind("Api.csproj")).toBe("csproj");
    expect(runtimeFileKind("Dockerfile")).toBe("dockerfile");
    expect(runtimeFileKind("Dockerfile.worker")).toBe("dockerfile");
    expect(runtimeFileKind("web.Dockerfile")).toBe("dockerfile");
    expect(runtimeFileKind("Containerfile")).toBe("dockerfile");
    expect(runtimeFileKind("docker-compose.yml")).toBe("compose");
    expect(runtimeFileKind("docker-compose.prod.yaml")).toBe("compose");
    expect(runtimeFileKind("compose.yaml")).toBe("compose");
    expect(runtimeFileKind("README.md")).toBeNull();
    expect(runtimeFileKind("Dockerfile.md")).toBeNull();
  });
});

describe("normalizeVersion", () => {
  it("takes the first version number of exact values and ranges", () => {
    expect(normalizeVersion("22")).toBe("22");
    expect(normalizeVersion("v22.11.0")).toBe("22.11.0");
    expect(normalizeVersion(">=8.2 <9")).toBe("8.2");
    expect(normalizeVersion("go1.23.2")).toBe("1.23.2");
    expect(normalizeVersion("1.2.3.4")).toBe("1.2.3");
    expect(normalizeVersion("lts/*")).toBeNull();
    expect(normalizeVersion("stable")).toBeNull();
  });
});

describe("Node", () => {
  it("reads .nvmrc LTS codenames and .node-version", () => {
    expect(brief(parse(".nvmrc"))).toEqual(["node lts/iron (20) · .nvmrc"]);
    expect(brief(parse(".node-version"))).toEqual(["node v22.11.0 (22.11.0) · .node-version"]);
  });

  it("reads package.json engines.node and volta.node", () => {
    expect(brief(parse("package.json"))).toEqual([
      "node >=22.12 <23 (22.12) · package.json engines.node",
      "node 22.11.0 (22.11.0) · package.json volta.node",
    ]);
  });

  it("ignores a package.json without engines", () => {
    expect(parseRuntimeFile("package-json", '{"name":"x"}', "package.json")).toEqual([]);
  });

  it("maps .tool-versions tools and skips unknown ones", () => {
    expect(brief(parse(".tool-versions"))).toEqual([
      "node 20.18.0 (20.18.0) · .tool-versions",
      "python 3.12.7 (3.12.7) · .tool-versions",
      "go 1.23.2 (1.23.2) · .tool-versions",
      "java temurin-21.0.4+7.0.LTS (21.0.4) · .tool-versions",
    ]);
  });

  it("reads mise.toml [tools] strings, arrays and inline tables", () => {
    expect(brief(parse("mise.toml"))).toEqual([
      "node 22 (22) · mise.toml tools.node",
      "python 3.13 (3.13) · mise.toml tools.python",
      "ruby 3.3.5 (3.3.5) · mise.toml tools.core:ruby",
    ]);
  });
});

describe("PHP", () => {
  it("reads composer.json require.php and config.platform.php", () => {
    expect(brief(parse("composer.json"))).toEqual([
      "php ^8.2 (8.2) · composer.json require.php",
      "php 8.3.12 (8.3.12) · composer.json config.platform.php",
    ]);
  });

  it("reads composer.lock platform and platform-overrides", () => {
    expect(brief(parse("composer.lock"))).toEqual([
      "php >=8.1 (8.1) · composer.lock platform.php",
      "php 8.3.12 (8.3.12) · composer.lock platform-overrides.php",
    ]);
  });
});

describe("Python", () => {
  it("reads .python-version, runtime.txt, pyproject and Pipfile", () => {
    expect(brief(parse(".python-version"))).toEqual(["python 3.12.7 (3.12.7) · .python-version"]);
    expect(brief(parse("runtime.txt"))).toEqual(["python 3.12.7 (3.12.7) · runtime.txt"]);
    expect(brief(parse("pyproject.toml"))).toEqual([
      "python >=3.11,<4 (3.11) · pyproject.toml requires-python",
      "python ^3.11 (3.11) · pyproject.toml python",
    ]);
    expect(brief(parse("Pipfile"))).toEqual(["python 3.11 (3.11) · Pipfile python_version"]);
  });
});

describe("Go, Ruby", () => {
  it("reads go.mod go and toolchain directives", () => {
    expect(brief(parse("go.mod"))).toEqual([
      "go 1.22.5 (1.22.5) · go.mod go",
      "go 1.23.2 (1.23.2) · go.mod toolchain",
    ]);
  });

  it("reads .ruby-version and Gemfile.lock RUBY VERSION", () => {
    expect(brief(parse(".ruby-version"))).toEqual(["ruby 3.3.5 (3.3.5) · .ruby-version"]);
    expect(brief(parse("Gemfile.lock"))).toEqual(["ruby 3.3.5p100 (3.3.5) · Gemfile.lock"]);
  });
});

describe("Java", () => {
  it("prefers maven.compiler.release over java.version in pom.xml", () => {
    expect(brief(parse("pom.xml"))).toEqual(["java 21 (21) · pom.xml maven.compiler.release"]);
  });

  it("reads Gradle sourceCompatibility (1.8 -> 8) and prefers the toolchain", () => {
    expect(brief(parse("build.gradle"))).toEqual([
      "java 1.8 (8) · build.gradle sourceCompatibility",
    ]);
    expect(brief(parse("build.gradle.kts"))).toEqual(["java 21 (21) · build.gradle.kts toolchain"]);
  });

  it("reads .sdkmanrc java only", () => {
    expect(brief(parse(".sdkmanrc"))).toEqual(["java 21.0.4-tem (21.0.4) · .sdkmanrc java"]);
  });
});

describe(".NET, Rust", () => {
  it("reads global.json sdk.version and csproj target frameworks", () => {
    expect(brief(parse("global.json"))).toEqual([
      "dotnet 8.0.403 (8.0.403) · global.json sdk.version",
    ]);
    expect(brief(parse("Api.csproj"))).toEqual([
      "dotnet net8.0 (8.0) · Api.csproj TargetFramework",
      "dotnet net9.0-windows (9.0) · Api.csproj TargetFramework",
    ]);
  });

  it("reads rust-toolchain channels and Cargo.toml rust-version", () => {
    expect(brief(parse("rust-toolchain"))).toEqual(["rust stable (-) · rust-toolchain"]);
    expect(brief(parse("rust-toolchain.toml"))).toEqual([
      "rust 1.82.0 (1.82.0) · rust-toolchain.toml channel",
    ]);
    expect(brief(parse("Cargo.toml"))).toEqual(["rust 1.75 (1.75) · Cargo.toml rust-version"]);
  });
});

describe("Dockerfile", () => {
  it("maps every FROM image, ignoring --platform, stage aliases and scratch", () => {
    expect(brief(parse("Dockerfile"))).toEqual([
      "node 22-bookworm-slim (22) · Dockerfile",
      "php 8.3-fpm-alpine (8.3) · Dockerfile",
      "php ${PHP_VERSION}-cli (-) ? · Dockerfile",
      "nginx 1.27.2-alpine (1.27.2) · Dockerfile",
      "image ghcr.io/acme/tools:2.1 (-) · Dockerfile",
      "dotnet 8.0 (8.0) · Dockerfile",
      "deno alpine-2.0.6 (2.0.6) · Dockerfile",
      "go golang@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef (-) ? · Dockerfile",
      "node 22 (22) · Dockerfile",
      "node latest (-) · Dockerfile",
    ]);
  });

  it("handles a lower-case from and a stage that reuses the image name", () => {
    const out = parseRuntimeFile("dockerfile", "from php:8.4 as php\nFROM php\n", "Dockerfile");
    expect(brief(out)).toEqual(["php 8.4 (8.4) · Dockerfile"]);
  });
});

describe("docker-compose", () => {
  it("maps service images and reports unknown or substituted ones as image", () => {
    expect(brief(parse("docker-compose.yml"))).toEqual([
      "postgres 16.4 (16.4) · docker-compose.yml",
      "valkey 8-alpine (8) · docker-compose.yml",
      "mariadb 11.4 (11.4) · docker-compose.yml",
      "image ${SEARCH_IMAGE:-opensearchproject/opensearch:2} (-) ? · docker-compose.yml",
      "nginx latest (-) · docker-compose.yml",
    ]);
  });

  it("returns nothing for a compose file without services", () => {
    expect(parseRuntimeFile("compose", "version: '3'\n", "compose.yaml")).toEqual([]);
  });
});

describe("image references", () => {
  it("strips Docker Hub registry and library prefixes and digests", () => {
    expect(imageRepository("docker.io/library/php:8.3@sha256:ab")).toEqual({
      repository: "php",
      tag: "8.3",
      digest: "sha256:ab",
    });
    expect(imageRepository("localhost:5000/app")).toEqual({
      repository: "localhost:5000/app",
      tag: null,
      digest: null,
    });
  });

  it("keeps a digest-only reference as an unknown version, never `latest`", () => {
    const ref = `golang@sha256:${"a".repeat(64)}`;
    expect(imageRuntime(ref, "Dockerfile")).toEqual({
      name: "go",
      version: ref,
      normalized: null,
      source: "Dockerfile",
      unresolved: true,
      image: "golang",
    });
    expect(imageRuntime(`node:22@sha256:${"b".repeat(64)}`, "Dockerfile")).toMatchObject({
      name: "node",
      version: "22",
      normalized: "22",
      unresolved: false,
    });
    expect(imageRuntime("node", "Dockerfile")).toMatchObject({
      version: "latest",
      normalized: null,
      unresolved: false,
    });
  });

  it("parses tag version prefixes", () => {
    expect(tagVersion("8.3-fpm-alpine")).toBe("8.3");
    expect(tagVersion("16.4")).toBe("16.4");
    expect(tagVersion("lts-alpine3.20")).toBeNull();
    expect(tagVersion("alpine-2.0.6")).toBe("2.0.6");
  });

  it("maps official Java and .NET images", () => {
    expect(imageRuntime("eclipse-temurin:21-jre", "Dockerfile")).toMatchObject({
      name: "java",
      normalized: "21",
    });
    expect(imageRuntime("mcr.microsoft.com/dotnet/sdk:9.0", "Dockerfile")).toMatchObject({
      name: "dotnet",
      normalized: "9.0",
      image: "mcr.microsoft.com/dotnet/sdk",
    });
    expect(imageRuntime("oven/bun:1.1-alpine", "Dockerfile")).toMatchObject({
      name: "bun",
      normalized: "1.1",
    });
  });
});

describe("mergeRuntimes", () => {
  it("keeps one row per name, source and version", () => {
    const a = imageRuntime("php:8.3", "Dockerfile");
    const merged = mergeRuntimes([[a], [{ ...a }, imageRuntime("php:8.2", "Dockerfile")]]);
    expect(merged.map((r) => r.version)).toEqual(["8.2", "8.3"]);
  });
});

describe("constraints", () => {
  it("flags ranges and leaves concrete versions unflagged", () => {
    const flagged = (name: string) => parse(name).map((r) => [r.version, r.constraint ?? false]);
    expect(flagged("package.json")).toEqual([
      [">=22.12 <23", true],
      ["22.11.0", false],
    ]);
    expect(flagged("composer.json")).toEqual(
      parse("composer.json").map((r) => [r.version, isVersionConstraint(r.version)])
    );
    expect(flagged("Dockerfile").every(([, c]) => c === false)).toBe(true);
    expect(flagged("go.mod").every(([, c]) => c === false)).toBe(true);
  });

  it("tells constraints from versions", () => {
    expect([">=20", "^8.3", "~1.2", "18 || 20", "22.x", "3.11.*"].map(isVersionConstraint)).toEqual(
      Array(6).fill(true)
    );
    expect(
      ["22", "22.11.0", "22-alpine", "8.3-fpm", "lts/iron", "1.23"].map(isVersionConstraint)
    ).toEqual(Array(6).fill(false));
  });

  it("derives the flag for rows from scanners that did not send it", () => {
    const row = { version: ">=20", source: "package.json engines.node", unresolved: false };
    expect(isConstraintRow(row)).toBe(true);
    expect(isConstraintRow({ ...row, constraint: false })).toBe(false);
    // Rows stored before the column existed are null: derived like an old upload.
    expect(isConstraintRow({ ...row, constraint: null })).toBe(true);
    expect(isConstraintRow({ ...row, version: "22.11.0" })).toBe(false);
    expect(isConstraintRow({ ...row, source: "Dockerfile", version: "22-alpine" })).toBe(false);
  });
});

describe("runtimeEvidence", () => {
  const workspace = (file: string) => {
    const kind = runtimeFileKind(path.basename(file));
    if (!kind) throw new Error(`no runtime parser for ${file}`);
    return parseRuntimeFile(kind, fixture(path.join("workspace", file)), file);
  };
  // The Briff repo: node:22 image, root engines >=22.12, packages/scan engines >=20.
  const rows = mergeRuntimes([
    workspace("Dockerfile"),
    workspace("package.json"),
    workspace("packages/scan/package.json"),
  ]);

  it("keeps the concrete rows when there are any", () => {
    expect(brief(rows)).toEqual([
      "node 22-alpine (22) · Dockerfile",
      "node >=22.12 (22.12) · package.json engines.node",
      "node >=20 (20) · packages/scan/package.json engines.node",
    ]);
    expect(brief(runtimeEvidence(rows))).toEqual(["node 22-alpine (22) · Dockerfile"]);
  });

  it("prefers the root's constraint over a workspace package's", () => {
    const constraints = rows.filter((r) => r.constraint);
    expect(brief(runtimeEvidence(constraints))).toEqual([
      "node >=22.12 (22.12) · package.json engines.node",
    ]);
  });

  it("falls back to a nested constraint when the root says nothing", () => {
    const nested = rows.filter((r) => r.source.startsWith("packages/"));
    expect(runtimeEvidence(nested)).toEqual(nested);
  });
});
