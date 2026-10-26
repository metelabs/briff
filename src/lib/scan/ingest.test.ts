import { describe, expect, it } from "vitest";

import { dedupeDependencies, runtimesAdded } from "./ingest";

describe("dedupeDependencies", () => {
  it("keeps one row per name@version and prefers the direct flag", () => {
    const out = dedupeDependencies([
      { name: "react", version: "19.0.0", direct: false },
      { name: "react", version: "19.0.0", direct: true },
      { name: "react", version: "18.3.1", direct: false },
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((d) => d.version === "19.0.0")?.direct).toBe(true);
  });
});

describe("dedupeDependencies across ecosystems", () => {
  it("keeps the same name in two ecosystems apart and normalises Composer names", () => {
    const out = dedupeDependencies([
      { name: "log", version: "3.0.2", direct: true },
      { name: "log", version: "3.0.2", direct: false, ecosystem: "Packagist" },
      { name: "Acme/Log", version: "3.0.2", direct: true, ecosystem: "Packagist" },
    ]);
    expect(out).toEqual(
      [
        { ecosystem: "npm", name: "log", version: "3.0.2", direct: true },
        { ecosystem: "Packagist", name: "log", version: "3.0.2", direct: false },
        { ecosystem: "Packagist", name: "acme/log", version: "3.0.2", direct: true },
      ].map((d) => ({
        ...d,
        dev: false,
        manager: null,
        group: null,
        requirement: null,
        project: null,
        constraint: false,
        metadata: undefined,
        unresolved: false,
      }))
    );
  });

  it("normalises PyPI names per PEP 503 and keeps the manager and the unresolved flag", () => {
    expect(
      dedupeDependencies([
        {
          name: "Flask_SQLAlchemy",
          version: "3.1.1",
          direct: false,
          ecosystem: "PyPI",
          manager: "poetry",
        },
        { name: "flask-sqlalchemy", version: "3.1.1", direct: true, ecosystem: "PyPI" },
        {
          name: "requests",
          version: ">=2.31",
          direct: true,
          ecosystem: "PyPI",
          manager: "pip",
          constraint: false,
          metadata: undefined,
          unresolved: true,
        },
      ])
    ).toEqual([
      {
        ecosystem: "PyPI",
        name: "flask-sqlalchemy",
        version: "3.1.1",
        direct: true,
        dev: false,
        manager: "poetry",
        group: null,
        requirement: null,
        project: null,
        constraint: false,
        metadata: undefined,
        unresolved: false,
      },
      {
        ecosystem: "PyPI",
        name: "requests",
        version: ">=2.31",
        direct: true,
        dev: false,
        manager: "pip",
        group: null,
        requirement: null,
        project: null,
        constraint: false,
        metadata: undefined,
        unresolved: true,
      },
    ]);
  });
});

describe("dedupeDependencies dev flag", () => {
  it("is development-only while no row declares the package for production", () => {
    const row = (direct: boolean, dev?: boolean) => ({
      name: "acme/test-runner",
      version: "10.5.9",
      direct,
      ecosystem: "Packagist" as const,
      ...(dev ? { dev } : {}),
    });
    expect(dedupeDependencies([row(true, true), row(false)])[0]).toMatchObject({
      dev: true,
      direct: true,
    });
    expect(dedupeDependencies([row(true, true), row(true)])[0]).toMatchObject({ dev: false });
  });
});

describe("dedupeDependencies group", () => {
  it("keeps every section either row declares", () => {
    const row = (group?: string, dev?: boolean) => ({
      name: "acme-http",
      version: "2.31.0",
      direct: true,
      ecosystem: "PyPI" as const,
      ...(group ? { group } : {}),
      ...(dev ? { dev } : {}),
    });
    expect(dedupeDependencies([row("extra:http"), row("test", true)])[0]).toMatchObject({
      dev: false,
      group: "extra:http,test",
    });
    expect(dedupeDependencies([row("extra:http"), row()])[0]).toMatchObject({
      group: "extra:http,.",
    });
    expect(dedupeDependencies([row(), row()])[0]).toMatchObject({ group: null });
  });
});

describe("runtimesAdded", () => {
  const php83 = { name: "php", version: "8.3-fpm", normalized: "8.3" };
  it("flags a new runtime or a new version, not a removal or a re-upload", () => {
    expect(runtimesAdded([], [php83])).toBe(true);
    expect(runtimesAdded([php83], [{ ...php83, version: "8.4-fpm", normalized: "8.4" }])).toBe(
      true
    );
    expect(runtimesAdded([php83], [php83])).toBe(false);
    expect(runtimesAdded([php83, { name: "node", version: "22", normalized: "22" }], [php83])).toBe(
      false
    );
  });
});
