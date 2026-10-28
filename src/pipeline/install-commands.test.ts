import { describe, expect, it } from "vitest";

import { installCommand, whyCommand } from "./install-commands";

describe("installCommand / whyCommand", () => {
  it("speaks each ecosystem's tool, npm by default", () => {
    expect(installCommand(undefined, "next", "16.3.8")).toBe("npm i next@16.3.8");
    expect(installCommand("npm", "@acme/ui", "2.1.0")).toBe("npm i @acme/ui@2.1.0");
    expect(installCommand("Packagist", "acme/log", "3.0.3")).toBe(
      "composer require acme/log:^3.0.3"
    );
    expect(installCommand("Packagist", "acme/test-runner", "10.5.10", { dev: true })).toBe(
      "composer require --dev acme/test-runner:^10.5.10"
    );
    // npm updates a package where it is declared; no flag needed.
    expect(installCommand("npm", "vitest", "4.1.11", { dev: true })).toBe("npm i vitest@4.1.11");
    expect(whyCommand(undefined, "undici")).toBe("npm ls undici");
    expect(whyCommand("Packagist", "acme/log")).toBe("composer why acme/log");
  });

  it("speaks the Python tool whose lockfile listed the package", () => {
    expect(installCommand("PyPI", "acme-http", "2.32.0")).toBe("pip install acme-http==2.32.0");
    expect(installCommand("PyPI", "acme-http", "2.32.0", { manager: "uv" })).toBe(
      "uv add acme-http==2.32.0"
    );
    expect(installCommand("PyPI", "acme-http", "2.32.0", { manager: "poetry" })).toBe(
      "poetry add acme-http@2.32.0"
    );
    expect(installCommand("PyPI", "acme-http", "2.32.0", { manager: "pipenv" })).toBe(
      "pipenv install acme-http==2.32.0"
    );
    expect(installCommand("PyPI", "acme-lint", "0.6.10", { manager: "poetry", dev: true })).toBe(
      "poetry add --group dev acme-lint@0.6.10"
    );
    expect(installCommand("PyPI", "acme-lint", "0.6.10", { manager: "uv", dev: true })).toBe(
      "uv add --dev acme-lint==0.6.10"
    );
    expect(
      installCommand("PyPI", "acme-mock", "1.2.1", { manager: "uv", dev: true, group: "test" })
    ).toBe("uv add --group test acme-mock==1.2.1");
    expect(
      installCommand("PyPI", "acme-docs", "2.0.1", { manager: "poetry", dev: true, group: "docs" })
    ).toBe("poetry add --group docs acme-docs@2.0.1");
    expect(
      installCommand("PyPI", "acme-http", "2.32.0", { manager: "uv", group: "extra:http" })
    ).toBe("uv add --optional http acme-http==2.32.0");
    expect(
      installCommand("PyPI", "acme-http", "2.32.0", { manager: "poetry", group: "extra:http" })
    ).toBe("poetry add --optional http acme-http@2.32.0");
    expect(whyCommand("PyPI", "acme-idna", "uv")).toBe("uv tree --invert --package acme-idna");
    expect(whyCommand("PyPI", "acme-idna", "poetry")).toBe("pipdeptree -r -p acme-idna");
  });

  it("puts the v back on Go versions", () => {
    expect(installCommand("Go", "golang.org/x/net", "0.33.0")).toBe(
      "go get golang.org/x/net@v0.33.0"
    );
    expect(whyCommand("Go", "golang.org/x/text")).toBe("go mod why -m golang.org/x/text");
  });

  it("edits a Go replacement instead of the requirement it overrides", () => {
    expect(
      installCommand("Go", "github.com/acme-mirror/forked", "1.0.4", {
        requirement: "github.com/acme/forked",
      })
    ).toBe(
      "go mod edit -replace=github.com/acme/forked=github.com/acme-mirror/forked@v1.0.4 && go mod tidy"
    );
    expect(
      installCommand("Go", "golang.org/x/text", "0.18.2", {
        requirement: "golang.org/x/text@v0.18.0",
      })
    ).toBe(
      "go mod edit -replace=golang.org/x/text@v0.18.0=golang.org/x/text@v0.18.2 && go mod tidy"
    );
  });
});

describe("installCommand keeps declarations", () => {
  it("keeps a declaration's extras and marker and replaces only the version", () => {
    const requirement = 'acme-http[socks]; python_version >= "3.9"';
    expect(installCommand("PyPI", "acme-http", "2.32.0", { manager: "uv", requirement })).toBe(
      `uv add 'acme-http[socks]==2.32.0; python_version >= "3.9"'`
    );
    expect(installCommand("PyPI", "acme-http", "2.32.0", { manager: "poetry", requirement })).toBe(
      `poetry add 'acme-http[socks]==2.32.0; python_version >= "3.9"'`
    );
    expect(
      installCommand("PyPI", "acme-http", "2.32.0", {
        manager: "poetry",
        requirement: "acme-http[socks]",
      })
    ).toBe("poetry add 'acme-http[socks]@2.32.0'");
    expect(
      installCommand("PyPI", "acme-http", "2.32.0", { manager: "uv", project: "acme-api" })
    ).toBe("uv add --package acme-api acme-http==2.32.0");
    expect(
      installCommand("PyPI", "acme-http", "2.32.0", { manager: "uv", project: ".,acme-api" })
    ).toBe(
      "uv add --frozen acme-http==2.32.0 && uv add --frozen --package acme-api acme-http==2.32.0 && uv lock"
    );
    expect(
      installCommand("PyPI", "acme-probe", "1.0.1", {
        manager: "uv",
        dev: true,
        group: "test,lint",
        project: ".,acme-api:test",
      })
    ).toBe(
      "uv add --frozen --group test acme-probe==1.0.1 && uv add --frozen --group lint acme-probe==1.0.1 && uv add --frozen --package acme-api --group test acme-probe==1.0.1 && uv lock"
    );
    expect(
      installCommand("PyPI", "acme-http", "2.32.0", {
        manager: "uv",
        project: "acme-api:extra:http",
      })
    ).toBe("uv add --package acme-api --optional http acme-http==2.32.0");
    expect(
      installCommand("PyPI", "acme-probe", "1.0.1", { manager: "poetry", group: ".,test" })
    ).toBe(
      "set the acme-probe declarations in pyproject.toml (main; test) to 1.0.1, then run poetry lock"
    );
    // Each declaration keeps its own extras and marker.
    expect(
      installCommand("PyPI", "acme-probe", "1.0.1", {
        manager: "uv",
        group: ".,test",
        requirement: 'test\tacme-probe[socks]; sys_platform == "linux"',
      })
    ).toBe(
      `uv add --frozen acme-probe==1.0.1 && uv add --frozen --group test 'acme-probe[socks]==1.0.1; sys_platform == "linux"' && uv lock`
    );
    expect(installCommand("PyPI", "acme-http", "2.32.0", { requirement })).toBe(
      "pip install 'acme-http[socks]==2.32.0'"
    );
  });
});

describe("installCommand with one pin declared per platform", () => {
  it("updates each declaration before locking once", () => {
    expect(
      installCommand("PyPI", "acme-probe", "1.0.1", {
        manager: "uv",
        requirement:
          '.\tacme-probe; sys_platform == "linux"\n.\tacme-probe; sys_platform == "win32"',
      })
    ).toBe(
      `uv add --frozen 'acme-probe==1.0.1; sys_platform == "linux"' && uv add --frozen 'acme-probe==1.0.1; sys_platform == "win32"' && uv lock`
    );
  });
});

describe("installCommand for a Poetry multiple-constraint alternative", () => {
  it("names the entry to edit instead of a command that would replace the list", () => {
    expect(
      installCommand("PyPI", "acme-probe", "2.0.1", {
        manager: "poetry",
        requirement: '.\t!acme-probe; python_full_version >= "3.11.0"',
      })
    ).toBe(
      'set the acme-probe entry for python_full_version >= "3.11.0" in pyproject.toml to 2.0.1, then run poetry lock'
    );
  });
});

describe("installCommand with a bare and a conditional declaration in one section", () => {
  it("updates both", () => {
    expect(
      installCommand("PyPI", "acme-probe", "1.0.1", {
        manager: "uv",
        requirement: '.\tacme-probe\n.\tacme-probe; sys_platform == "linux"',
      })
    ).toBe(
      `uv add --frozen acme-probe==1.0.1 && uv add --frozen 'acme-probe==1.0.1; sys_platform == "linux"' && uv lock`
    );
  });
});

describe("installCommand for several Poetry alternatives", () => {
  it("names only the affected alternatives", () => {
    expect(
      installCommand("PyPI", "acme-probe", "2.0.1", {
        manager: "poetry",
        requirement:
          '.\t!acme-probe; sys_platform == "linux"\n.\t!acme-probe; sys_platform == "win32"',
      })
    ).toBe(
      'set the acme-probe declarations in pyproject.toml (main for sys_platform == "linux"; main for sys_platform == "win32") to 2.0.1, then run poetry lock'
    );
  });
});

it("keeps Cargo declarations while updating an exact lockfile pin", () => {
  expect(installCommand("crates.io", "time", "0.3.36", { requirement: "0.3.17", dev: true })).toBe(
    "cargo update -p time@0.3.17 --precise 0.3.36"
  );
  expect(whyCommand("crates.io", "time")).toBe("cargo tree -i time");
});

it("keeps Bundler declarations in their existing groups with a bounded constraint", () => {
  expect(installCommand("RubyGems", "rack", "2.2.9", { dev: true })).toBe(
    'set rack in Gemfile to "~> 2.2.9", then run bundle update rack --conservative'
  );
  expect(whyCommand("RubyGems", "rack")).toBe(
    "bundle exec gem dependency rack --reverse-dependencies"
  );
});

it("names the Maven or Gradle declaration and uses the tool's dependency tree", () => {
  expect(
    installCommand("Maven", "org.acme:kit", "1.2.4", { project: "api/pom.xml", manager: "maven" })
  ).toContain("api/pom.xml to 1.2.4");
  expect(
    installCommand("Maven", "org.acme:kit", "1.2.4", {
      project: "build.gradle.kts",
      manager: "gradle",
    })
  ).toContain("build.gradle.kts to 1.2.4");
  expect(whyCommand("Maven", "org.acme:kit", "maven")).toBe("mvn dependency:tree");
  expect(whyCommand("Maven", "org.acme:kit", "gradle")).toBe(
    "./gradlew dependencies --configuration runtimeClasspath"
  );
});

it("targets every NuGet project and quotes shell arguments", () => {
  expect(
    installCommand("NuGet", "acme.kit", "1.2.4", {
      project: "api/Acme.csproj,Worker App/Worker.csproj",
    })
  ).toBe(
    "dotnet add api/Acme.csproj package acme.kit --version 1.2.4 && dotnet add 'Worker App/Worker.csproj' package acme.kit --version 1.2.4"
  );
  expect(whyCommand("NuGet", "acme.kit", undefined, "api/Acme.csproj")).toBe(
    "dotnet nuget why api/Acme.csproj acme.kit"
  );
});

it("preserves framework boundaries for conditional NuGet declarations", () => {
  for (const version of ["8.0.5", "9.0.1"]) {
    expect(
      installCommand("NuGet", "system.text.json", version, {
        project: "Acme.csproj",
        requirement: "nuget-conditional",
      })
    ).toBe(
      `set only the system.text.json PackageReference or central PackageVersion declarations on the ${version[0]} release line in Acme.csproj to ${version}; preserve other framework conditions and versions`
    );
  }
});

it("keeps pub fixes on the chosen line and runs each project's own tool", () => {
  expect(
    installCommand("Pub", "dio", "4.0.6", { project: "pubspec.yaml:flutter,cli/pubspec.yaml:dart" })
  ).toBe(
    'set dio in pubspec.yaml to "^4.0.6", then run flutter pub upgrade dio; set dio in cli/pubspec.yaml to "^4.0.6", then run (cd cli && dart pub upgrade dio)'
  );
  expect(installCommand("Pub", "archive", "0.3.2", { dev: true })).toContain(
    '"^0.3.2" under dev_dependencies'
  );
  expect(whyCommand("Pub", "dio")).toBe("dart pub deps");
});

it("updates Pub's effective override instead of leaving its vulnerable pin in place", () => {
  expect(
    installCommand("Pub", "dio", "4.0.6", {
      dev: true,
      project: "pubspec.yaml:dart:dependency_overrides",
    })
  ).toBe(
    'set dio in pubspec.yaml to "^4.0.6" under dependency_overrides, then run dart pub upgrade dio'
  );
});

it("pins SwiftPM's existing rule before updating its package identity", () => {
  expect(
    installCommand("SwiftURL", "github.com/acme/Kit", "1.2.4", {
      project: "apps/server/Package.swift",
    })
  ).toBe(
    'set the github.com/acme/Kit version rule in apps/server/Package.swift to .exact("1.2.4"), then run (cd apps/server && swift package update kit)'
  );
  expect(whyCommand("SwiftURL", "github.com/acme/Kit")).toBe("swift package show-dependencies");
});
