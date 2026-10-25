import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { normalizePackageName, normalizeVersion } from "./ecosystems";
import {
  admits,
  parsePipfileLock,
  parsePoetryLock,
  parseRequirements,
  parseUvLock,
  pipfileDeclared,
  pyprojectDeclared,
  pythonMarker,
  withoutExtra,
  requirementName,
} from "./python-lock";

const fixture = (name: string) => readFileSync(path.join(__dirname, "__fixtures__", name), "utf8");
const brief = (deps: ReturnType<typeof parseRequirements>) =>
  deps.map(
    (d) =>
      `${d.name} ${d.version}${d.direct ? " direct" : ""}${d.dev ? " dev" : ""}${d.unresolved ? " unresolved" : ""} ${d.manager}`
  );

describe("PEP 503 names and PEP 440 versions", () => {
  it("normalises names", () => {
    expect(normalizePackageName("PyPI", "Flask_SQLAlchemy")).toBe("flask-sqlalchemy");
    expect(normalizePackageName("PyPI", "Acme.Charset")).toBe("acme-charset");
    expect(requirementName("Acme_Web[async]>=5 ; python_version>'3.8'")).toBe("acme-web");
  });

  it("reads versions in semver form only where PEP 440 means the same release", () => {
    expect(normalizeVersion("PyPI", "3.3")).toBe("3.3.0");
    expect(normalizeVersion("PyPI", "2024.2.2")).toBe("2024.2.2");
    expect(normalizeVersion("PyPI", "8.1.0rc1")).toBe("8.1.0-rc.1");
    expect(normalizeVersion("PyPI", "2.0b3")).toBe("2.0.0-b.3");
    expect(normalizeVersion("PyPI", "1.0.0-alpha.2")).toBe("1.0.0-a.2");
    // No semver form with the same ordering: kept as written.
    expect(normalizeVersion("PyPI", "1.0.post1")).toBe("1.0.post1");
    expect(normalizeVersion("PyPI", "2.0.0.dev3")).toBe("2.0.0.dev3");
    expect(normalizeVersion("PyPI", "1!2.0")).toBe("1!2.0");
    expect(normalizeVersion("PyPI", "1.2.3.4")).toBe("1.2.3.4");
  });
});

describe("parsePoetryLock", () => {
  const deps = parsePoetryLock(
    fixture("poetry-app.lock"),
    pyprojectDeclared(fixture("poetry-app.toml"))
  );

  it("reads every PyPI package with Poetry as the manager; direct from pyproject, groups as dev", () => {
    expect(brief(deps)).toEqual([
      "acme-http 2.31.0 direct poetry",
      "acme-certs 2024.2.2 poetry",
      "acme-charset 3.3.0 poetry",
      "acme-test 8.1.0-rc.1 direct dev poetry",
    ]);
    expect(deps.every((d) => d.ecosystem === "PyPI")).toBe(true);
  });

  it("skips path, git and url sources", () => {
    expect(deps.find((d) => d.name === "acme-internal")).toBeUndefined();
  });
});

describe("parseUvLock", () => {
  it("takes direct from the workspace project's dependencies and skips non-registry sources", () => {
    const deps = parseUvLock(fixture("uv-app.lock"), pyprojectDeclared(fixture("uv-app.toml")));
    expect(brief(deps)).toEqual([
      "acme-async 4.4.0 direct uv",
      "acme-idna 3.7.0 uv",
      "acme-sniff 1.3.1 uv",
      "acme-models 2.8.2 direct uv",
      "acme-lint 0.6.9 direct dev uv",
    ]);
  });

  it("still finds direct dependencies without a pyproject.toml", () => {
    const deps = parseUvLock(fixture("uv-app.lock"), {
      prod: [],
      extras: [],
      dev: [],
      requirements: {},
    });
    expect(deps.filter((d) => d.direct).map((d) => d.name)).toEqual([
      "acme-async",
      "acme-models",
      "acme-lint",
    ]);
  });
});

describe("dependency groups", () => {
  it("keeps the group a development-only package is declared in", () => {
    const manifest = [
      "[project]",
      'name = "acme-service"',
      'dependencies = ["acme-async>=4"]',
      "[dependency-groups]",
      'test = ["acme-mock>=1"]',
      "[tool.poetry.group.docs.dependencies]",
      'acme-docs = "^2"',
    ].join("\n");
    expect(pyprojectDeclared(manifest).dev).toEqual([
      { name: "acme-mock", group: "test" },
      { name: "acme-docs", group: "docs" },
    ]);
    const lock = [
      "[[package]]",
      'name = "acme-mock"',
      'version = "1.2.0"',
      'source = { registry = "https://pypi.org/simple" }',
    ].join("\n");
    expect(parseUvLock(lock, pyprojectDeclared(manifest))).toEqual([
      {
        name: "acme-mock",
        version: "1.2.0",
        direct: true,
        ecosystem: "PyPI",
        dev: true,
        group: "test",
        manager: "uv",
      },
    ]);
  });
});

describe("declared extras and markers", () => {
  it("keeps a declaration's extras and marker for the fix command", () => {
    const manifest = [
      "[project]",
      'name = "acme-service"',
      "dependencies = [",
      "  \"Acme_HTTP[socks]==2.31.0; python_version >= '3.9'\",",
      '  "acme-async>=4",',
      "]",
      "[tool.poetry.group.test.dependencies]",
      'acme-mock = { version = "^1", extras = ["async"], markers = "sys_platform == \'linux\'" }',
    ].join("\n");
    expect(pyprojectDeclared(manifest).requirements).toMatchObject({
      "acme-http": { ".": [{ shape: "acme-http[socks]; python_version >= '3.9'", pin: "2.31.0" }] },
      "acme-mock": { test: [{ shape: "acme-mock[async]; sys_platform == 'linux'", pin: null }] },
    });
  });
});

describe("two conditional pins of one package in one section", () => {
  it("gives each locked version its own declaration", () => {
    const manifest = [
      "[project]",
      'name = "acme-service"',
      "dependencies = [",
      "  \"acme-probe==1.0.0; sys_platform == 'linux'\",",
      "  \"acme-probe==1.0.1; sys_platform == 'win32'\",",
      "]",
    ].join("\n");
    const lock = ["1.0.0", "1.0.1"]
      .map(
        (v) =>
          `[[package]]\nname = "acme-probe"\nversion = "${v}"\nsource = { registry = "https://pypi.org/simple" }\n`
      )
      .join("\n");
    expect(parseUvLock(lock, pyprojectDeclared(manifest)).map((d) => d.requirement)).toEqual([
      ".\tacme-probe; sys_platform == 'linux'",
      ".\tacme-probe; sys_platform == 'win32'",
    ]);
  });
});

describe("declarations per locked version", () => {
  const lockOf = (...versions: string[]) =>
    versions
      .map(
        (v) =>
          `[[package]]\nname = "acme-probe"\nversion = "${v}"\nsource = { registry = "https://pypi.org/simple" }\n`
      )
      .join("\n");

  it("gives each locked version only the sections that pin it", () => {
    const manifest = [
      "[project]",
      'name = "acme-service"',
      "dependencies = [\"acme-probe==1.0.0; sys_platform == 'linux'\"]",
      "[dependency-groups]",
      "test = [\"acme-probe==2.0.0; sys_platform == 'win32'\"]",
    ].join("\n");
    const rows = parseUvLock(lockOf("1.0.0", "2.0.0"), pyprojectDeclared(manifest));
    expect(rows.map((d) => [d.version, d.group ?? ".", d.dev ?? false])).toEqual([
      ["1.0.0", ".", false],
      ["2.0.0", "test", true],
    ]);
  });

  it("never gives a workspace row the root's or a member's pin of another version", () => {
    const lock = [
      "[manifest]",
      'members = ["acme-root", "acme-api"]',
      "",
      "[[package]]",
      'name = "acme-root"',
      'version = "0.1.0"',
      'source = { virtual = "." }',
      'dependencies = [{ name = "acme-probe" }]',
      "",
      "[package.metadata]",
      'requires-dist = [{ name = "acme-probe", marker = "sys_platform == \'linux\'", specifier = "==1.0.0" }]',
      "",
      "[[package]]",
      'name = "acme-api"',
      'version = "0.1.0"',
      'source = { editable = "packages/api" }',
      'dependencies = [{ name = "acme-probe" }]',
      "",
      "[package.metadata]",
      'requires-dist = [{ name = "acme-probe", marker = "sys_platform == \'win32\'", specifier = "==2.0.0" }]',
      "",
      lockOf("1.0.0", "2.0.0"),
    ].join("\n");
    const rows = parseUvLock(lock, { prod: [], extras: [], dev: [], requirements: {} });
    expect(rows.map((d) => [d.version, d.project ?? "root"])).toEqual([
      ["1.0.0", "root"],
      ["2.0.0", "acme-api:."],
    ]);
  });

  it("gives each locked version only the ranges that admit it", () => {
    const manifest = [
      "[project]",
      'name = "acme-service"',
      "dependencies = [\"acme-probe>=1,<2; sys_platform == 'linux'\"]",
      "[dependency-groups]",
      "test = [\"acme-probe>=2,<3; sys_platform == 'win32'\"]",
    ].join("\n");
    const rows = parseUvLock(lockOf("1.4.0", "2.0.0"), pyprojectDeclared(manifest));
    expect(rows.map((d) => [d.version, d.group ?? "."])).toEqual([
      ["1.4.0", "."],
      ["2.0.0", "test"],
    ]);
  });

  it("moves an exact pin and an admitting range of the same version together", () => {
    const manifest = [
      "[project]",
      'name = "acme-service"',
      'dependencies = ["acme-probe>=1.0.0,<1.0.1"]',
      "[dependency-groups]",
      'test = ["acme-probe==1.0.0"]',
    ].join("\n");
    const [row] = parseUvLock(lockOf("1.0.0"), pyprojectDeclared(manifest));
    expect(row.group).toBe(".,test");
  });

  it("reads each alternative of a Poetry multiple-constraint dependency", () => {
    const manifest = [
      "[tool.poetry.dependencies]",
      'acme-probe = [{ version = "1.0.0", python = "<3.11" }, { version = "2.0.0", python = ">=3.11" }]',
    ].join("\n");
    const lock = ["1.0.0", "2.0.0"]
      .map((v) => `[[package]]\nname = "acme-probe"\nversion = "${v}"\n`)
      .join("\n");
    expect(parsePoetryLock(lock, pyprojectDeclared(manifest)).map((d) => d.requirement)).toEqual([
      '.\t!acme-probe; python_full_version < "3.11.0"',
      '.\t!acme-probe; python_full_version >= "3.11.0"',
    ]);
  });

  it("keeps a bare declaration next to a conditional one of the same pin", () => {
    const manifest = [
      "[project]",
      'name = "acme-service"',
      'dependencies = ["acme-probe==1.0.0", "acme-probe==1.0.0; sys_platform == \'linux\'"]',
    ].join("\n");
    const [row] = parseUvLock(lockOf("1.0.0"), pyprojectDeclared(manifest));
    expect(row.requirement).toBe(".\tacme-probe\n.\tacme-probe; sys_platform == 'linux'");
  });

  it("treats a version no declared range admits as transitive", () => {
    const manifest = [
      "[project]",
      'name = "acme-service"',
      "dependencies = [\"acme-probe>=1,<2; sys_platform == 'linux'\"]",
    ].join("\n");
    const rows = parseUvLock(lockOf("1.4.0", "2.0.0"), pyprojectDeclared(manifest));
    expect(rows.map((d) => [d.version, d.direct])).toEqual([
      ["1.4.0", true],
      ["2.0.0", false],
    ]);
  });

  it("reads a Poetry version union as a constraint, not a pin", () => {
    const manifest = ["[tool.poetry.dependencies]", 'acme-probe = "1.0.0 || 2.0.0"'].join("\n");
    const rows = parsePoetryLock(
      ["1.0.0", "2.0.0"]
        .map((v) => `[[package]]\nname = "acme-probe"\nversion = "${v}"\n`)
        .join("\n"),
      pyprojectDeclared(manifest)
    );
    expect(rows.map((d) => d.direct)).toEqual([true, true]);
  });

  it("reads a Poetry union of exact pins as a constraint", () => {
    const manifest = ["[tool.poetry.dependencies]", 'acme-probe = "==1.0.0 || ==2.0.0"'].join("\n");
    const rows = parsePoetryLock(
      ["1.0.0", "2.0.0"]
        .map((v) => `[[package]]\nname = "acme-probe"\nversion = "${v}"\n`)
        .join("\n"),
      pyprojectDeclared(manifest)
    );
    expect(rows.map((d) => d.direct)).toEqual([true, true]);
  });

  it("reads a Poetry wildcard as a range, not a pin", () => {
    const manifest = ["[tool.poetry.dependencies]", 'acme-probe = "1.*"'].join("\n");
    const [row] = parsePoetryLock(
      '[[package]]\nname = "acme-probe"\nversion = "1.2.3"\n',
      pyprojectDeclared(manifest)
    );
    expect(row.direct).toBe(true);
  });

  it("keeps every declaration that pins the same version", () => {
    const manifest = [
      "[project]",
      'name = "acme-service"',
      "dependencies = [",
      "  \"acme-probe==1.0.0; sys_platform == 'linux'\",",
      "  \"acme-probe==1.0.0; sys_platform == 'win32'\",",
      "]",
    ].join("\n");
    const [row] = parseUvLock(lockOf("1.0.0"), pyprojectDeclared(manifest));
    expect(row.requirement).toBe(
      ".\tacme-probe; sys_platform == 'linux'\n.\tacme-probe; sys_platform == 'win32'"
    );
  });
});

describe("Poetry python and platform conditions", () => {
  it("become markers on the declaration, compared on the full version", () => {
    expect(pythonMarker("^3.10")).toBe(
      'python_full_version >= "3.10.0" and python_full_version < "4.0.0"'
    );
    expect(pythonMarker(">=3.9,<3.13")).toBe(
      'python_full_version >= "3.9.0" and python_full_version < "3.13.0"'
    );
    expect(pythonMarker(">3.10")).toBe('python_full_version > "3.10.0"');
    expect(pythonMarker("<=3.10")).toBe('python_full_version <= "3.10.0"');
    expect(pythonMarker("==3.10")).toBe('python_full_version == "3.10.0"');
    expect(pythonMarker("3.*")).toBe(
      'python_full_version >= "3.0.0" and python_full_version < "4.0.0"'
    );
    expect(pythonMarker("!=3.10.*")).toBe(
      '(python_full_version < "3.10.0" or python_full_version >= "3.11.0")'
    );
    expect(pythonMarker("~3.11 || ~3.12")).toBe(
      '(python_full_version >= "3.11.0" and python_full_version < "3.12.0") or (python_full_version >= "3.12.0" and python_full_version < "3.13.0")'
    );
    expect(pythonMarker("~=3.10")).toBe(
      'python_full_version >= "3.10.0" and python_full_version < "4.0.0"'
    );
    expect(pythonMarker("~=3.10.2")).toBe(
      'python_full_version >= "3.10.2" and python_full_version < "3.11.0"'
    );
    expect(pythonMarker("*")).toBeNull();
    const manifest = [
      "[tool.poetry.dependencies]",
      'python = "^3.10"',
      'acme-http = { version = "2.31.0", python = ">=3.10", platform = "linux" }',
    ].join("\n");
    expect(pyprojectDeclared(manifest).requirements).toMatchObject({
      "acme-http": {
        ".": [
          {
            shape: 'acme-http; (python_full_version >= "3.10.0") and (sys_platform == "linux")',
            pin: "2.31.0",
          },
        ],
      },
    });
  });
});

describe("uv workspace edge cases", () => {
  const pkg = (name: string, version: string) =>
    `[[package]]\nname = "${name}"\nversion = "${version}"\nsource = { registry = "https://pypi.org/simple" }\n`;
  const empty = { prod: [], extras: [], dev: [], requirements: {} };

  it("does not take an editable path dependency for a workspace member", () => {
    const lock = [
      "[[package]]",
      'name = "acme-root"',
      'version = "0.1.0"',
      'source = { editable = "." }',
      'dependencies = [{ name = "acme-local" }]',
      "",
      "[[package]]",
      'name = "acme-local"',
      'version = "0.1.0"',
      'source = { editable = "../local" }',
      'dependencies = [{ name = "acme-probe" }]',
      "",
      pkg("acme-probe", "1.0.0"),
    ].join("\n");
    expect(parseUvLock(lock, empty)).toEqual([
      { name: "acme-probe", version: "1.0.0", direct: false, ecosystem: "PyPI", manager: "uv" },
    ]);
  });

  it("reads a member's development declarations from requires-dev", () => {
    const lock = [
      "[manifest]",
      'members = ["acme-root", "acme-api"]',
      "",
      "[[package]]",
      'name = "acme-root"',
      'version = "0.1.0"',
      'source = { virtual = "." }',
      "",
      "[[package]]",
      'name = "acme-api"',
      'version = "0.1.0"',
      'source = { editable = "packages/api" }',
      "",
      "[package.dev-dependencies]",
      'test = [{ name = "acme-probe" }]',
      "",
      "[package.metadata.requires-dev]",
      'test = [{ name = "acme-probe", marker = "sys_platform == \'linux\'", specifier = "==1.0.0" }]',
      "",
      pkg("acme-probe", "1.0.0"),
    ].join("\n");
    expect(parseUvLock(lock, empty)).toEqual([
      {
        name: "acme-probe",
        version: "1.0.0",
        direct: true,
        ecosystem: "PyPI",
        dev: true,
        requirement: "acme-api:test\tacme-probe; sys_platform == 'linux'",
        project: "acme-api:test",
        manager: "uv",
      },
    ]);
  });
});

describe("admits", () => {
  it("reads PEP 440 and Poetry constraints", () => {
    expect(admits(">=1,<2", "1.4.0")).toBe(true);
    expect(admits(">=1,<2", "2.0.0")).toBe(false);
    expect(admits("~=1.4", "1.9.0")).toBe(true);
    expect(admits("~=1.4.2", "1.5.0")).toBe(false);
    expect(admits("^0.4", "0.5.0")).toBe(false);
    expect(admits("^1.2", "1.9.9")).toBe(true);
    expect(admits("~1.2", "1.3.0")).toBe(false);
    expect(admits("==1.*", "1.7.0")).toBe(true);
    expect(admits("1.2.3", "1.2.3")).toBe(true);
    expect(admits(">=1,<2 || >=3", "3.1.0")).toBe(true);
    expect(admits("@ git", "1.0.0")).toBeNull();
  });
});

describe("withoutExtra", () => {
  it("drops extra membership from uv's requires-dist markers and keeps real conditions", () => {
    expect(withoutExtra("extra == 'http'")).toBeNull();
    expect(
      withoutExtra(
        "(sys_platform == 'linux' and extra == 'a') or (sys_platform == 'win32' and extra == 'a')"
      )
    ).toBe("sys_platform == 'linux' or sys_platform == 'win32'");
    expect(
      withoutExtra("python_version >= '3.9' and (extra == 'a' or sys_platform == 'linux')")
    ).toBe("python_version >= '3.9'");
    expect(withoutExtra("python_version >= '3.9' and extra == \"http\"")).toBe(
      "python_version >= '3.9'"
    );
  });
});

describe("uv workspaces", () => {
  it("names the member that declares a dependency the root does not", () => {
    const lock = [
      "[manifest]",
      'members = ["acme-root", "acme-api"]',
      "",
      "[[package]]",
      'name = "acme-root"',
      'version = "0.1.0"',
      'source = { virtual = "." }',
      'dependencies = [{ name = "acme-async" }]',
      "",
      "[[package]]",
      'name = "acme-api"',
      'version = "0.1.0"',
      'source = { editable = "packages/api" }',
      'dependencies = [{ name = "acme-http", extra = ["socks"] }, { name = "acme-async" }]',
      "",
      "[package.metadata]",
      'requires-dist = [{ name = "acme-http", extras = ["socks"], marker = "python_version >= \'3.9\'", specifier = "==2.31.0" }]',
      "",
      ...["acme-http 2.31.0", "acme-async 4.4.0"].flatMap((p) => {
        const [name, version] = p.split(" ");
        return [
          "[[package]]",
          `name = "${name}"`,
          `version = "${version}"`,
          'source = { registry = "https://pypi.org/simple" }',
          "",
        ];
      }),
    ].join("\n");
    expect(parseUvLock(lock, { prod: [], extras: [], dev: [], requirements: {} })).toEqual([
      {
        name: "acme-http",
        version: "2.31.0",
        direct: true,
        ecosystem: "PyPI",
        requirement: "acme-api:.\tacme-http[socks]; python_version >= '3.9'",
        project: "acme-api:.",
        manager: "uv",
      },
      // Declared by the root and by acme-api: both pins get updated.
      {
        name: "acme-async",
        version: "4.4.0",
        direct: true,
        ecosystem: "PyPI",
        project: ".,acme-api:.",
        manager: "uv",
      },
    ]);
  });
});

describe("optional extras", () => {
  it("keeps every section a production package is declared in", () => {
    const manifest = [
      "[project]",
      'name = "acme-service"',
      'dependencies = ["acme-async>=4"]',
      "[project.optional-dependencies]",
      'http = ["acme-http==2.31.0", "acme-async>=4"]',
    ].join("\n");
    expect(pyprojectDeclared(manifest).extras).toEqual([
      { name: "acme-http", extra: "http" },
      { name: "acme-async", extra: "http" },
    ]);
    const lock = ["acme-http 2.31.0", "acme-async 4.4.0"]
      .map((p) => {
        const [name, version] = p.split(" ");
        return `[[package]]\nname = "${name}"\nversion = "${version}"\nsource = { registry = "https://pypi.org/simple" }\n`;
      })
      .join("\n");
    expect(brief(parseUvLock(lock, pyprojectDeclared(manifest)))).toEqual([
      "acme-http 2.31.0 direct uv",
      "acme-async 4.4.0 direct uv",
    ]);
    // In the main list and in the extra: both declarations are updated.
    expect(parseUvLock(lock, pyprojectDeclared(manifest)).map((d) => d.group)).toEqual([
      "extra:http",
      ".,extra:http",
    ]);
  });
});

describe("a package in several dependency groups", () => {
  it("lists every group, so each pin is updated", () => {
    const manifest = [
      "[project]",
      'name = "acme-service"',
      "[dependency-groups]",
      'test = ["acme-probe==1.0.0"]',
      'lint = ["acme-probe==1.0.0"]',
    ].join("\n");
    const lock =
      '[[package]]\nname = "acme-probe"\nversion = "1.0.0"\nsource = { registry = "https://pypi.org/simple" }\n';
    expect(parseUvLock(lock, pyprojectDeclared(manifest))).toEqual([
      {
        name: "acme-probe",
        version: "1.0.0",
        direct: true,
        ecosystem: "PyPI",
        dev: true,
        group: "test,lint",
        manager: "uv",
      },
    ]);
  });
});

describe("parsePipfileLock", () => {
  it("reads default and develop pins; editable entries have no version", () => {
    const deps = parsePipfileLock(
      fixture("pipenv-app.lock"),
      pipfileDeclared(fixture("pipenv-app.Pipfile"))
    );
    expect(brief(deps)).toEqual([
      "acme-web 5.0.6 direct pipenv",
      "acme-sql 0.5.0 pipenv",
      "acme-test 8.2.2 direct dev pipenv",
    ]);
  });
});

describe("parseRequirements", () => {
  it("reads pip-compile output: pins, and direct only for what requirements.in asked for", () => {
    expect(brief(parseRequirements(fixture("requirements-compiled.txt")))).toEqual([
      "acme-certs 2024.2.2 pip",
      "acme-http 2.31.0 direct pip",
      "acme-idna 3.7.0 pip",
      "acme-async 4.4.0 direct pip",
    ]);
  });

  it("counts a dependency pip-compile took from pyproject.toml as direct", () => {
    const compiled = [
      "acme-http==2.31.0",
      "    # via acme-service (pyproject.toml)",
      "acme-idna==3.7",
      "    # via acme-http",
      "acme-cli==1.0.0",
      "    # via",
      "    #   -c constraints.txt",
      "    #   acme-http",
      "acme-tool==2.0.0",
      "    # via",
      "    #   -c constraints.txt",
      "    #   -r requirements.in",
    ].join("\n");
    expect(brief(parseRequirements(compiled))).toEqual([
      "acme-http 2.31.0 direct pip",
      "acme-idna 3.7.0 pip",
      // A constraint only pins the version; acme-http still pulls it in.
      "acme-cli 1.0.0 pip",
      "acme-tool 2.0.0 direct pip",
    ]);
  });

  it("reads inline (line-style) via annotations", () => {
    expect(
      brief(
        parseRequirements(
          "acme-idna==3.7  # via acme-http, acme-async\nacme-http==2.31.0  # via -r requirements.in\n"
        )
      )
    ).toEqual(["acme-idna 3.7.0 pip", "acme-http 2.31.0 direct pip"]);
  });

  it("reads a pin written in parentheses and never takes a bracket for a version", () => {
    expect(brief(parseRequirements("Acme_Web (==4.2.1)\nacme-orm (>=2.0)\n"))).toEqual([
      "acme-web 4.2.1 direct pip",
      "acme-orm >=2.0 direct unresolved pip",
    ]);
  });

  it("keeps unpinned requirements as unresolved and skips options, URLs and paths", () => {
    expect(brief(parseRequirements(fixture("requirements-loose.txt")))).toEqual([
      "acme-web >=5.0,<6 direct unresolved pip",
      "acme-orm ~=2.0 direct unresolved pip",
      "acme-cli * direct unresolved pip",
      "acme-wild ==2.* direct unresolved pip",
      "acme-pinned 1.4.2 direct pip",
    ]);
  });
});

describe("pyproject / Pipfile direct names", () => {
  it("splits production from development and never counts python itself", () => {
    expect(pyprojectDeclared(fixture("poetry-app.toml"))).toMatchObject({
      prod: ["acme-http", "acme-internal"],
      extras: [],
      dev: [{ name: "acme-test", group: "dev" }],
    });
    expect(pyprojectDeclared(fixture("uv-app.toml"))).toMatchObject({
      prod: ["acme-async", "acme-models", "acme-forked"],
      extras: [],
      dev: [{ name: "acme-lint", group: "dev" }],
    });
    expect(pipfileDeclared(fixture("pipenv-app.Pipfile"))).toMatchObject({
      prod: ["acme-web", "acme-local"],
      extras: [],
      dev: [{ name: "acme-test", group: "dev" }],
    });
    expect(pyprojectDeclared("[project")).toMatchObject({
      prod: [],
      extras: [],
      dev: [],
    });
    expect(pipfileDeclared(null)).toMatchObject({
      prod: [],
      extras: [],
      dev: [],
      requirements: {},
    });
  });
});
