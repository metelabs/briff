import { readFileSync } from "node:fs";
import { collectFromFiles } from "@scan/collect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { matchItem } from "@/lib/match/matcher";
import { loadOrgStacks } from "@/lib/match/stack";

import { ingestScan } from "./ingest";
import type { ScanBody, ScanRuntime } from "./schema";

// Runs only when TEST_DATABASE_URL points at a migrated, disposable database.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("scan ingest of runtimes against Postgres", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  const repoName = `garden-${suffix}`;
  let orgId = "";

  const body = (runtimes?: ScanRuntime[]): ScanBody => ({
    source: "local",
    repos: [{ name: repoName, path: repoName, ecosystem: "npm", dependencies: [], runtimes }],
  });
  const php: ScanRuntime = {
    name: "php",
    version: "8.3-fpm",
    normalized: "8.3",
    source: "Dockerfile",
    unresolved: false,
  };
  const stored = () =>
    withOrg(db, orgId).repoRuntime.findMany({
      orderBy: { name: "asc" },
      select: { name: true, version: true, normalized: true, source: true },
    });

  beforeAll(async () => {
    orgId = (await db.org.create({ data: { name: `r-${suffix}` } })).id;
  });

  afterAll(async () => {
    await db.org.deleteMany({ where: { id: orgId } });
    await db.$disconnect();
  });

  it("stores runtimes, keeps them for an upload without the field, replaces them otherwise", async () => {
    const [first] = await ingestScan(db, orgId, body([php, { ...php }]));
    expect(first).toMatchObject({ created: true, dependencies: 0, runtimes: 1 });
    expect(await stored()).toEqual([
      { name: "php", version: "8.3-fpm", normalized: "8.3", source: "Dockerfile" },
    ]);

    const [legacy] = await ingestScan(db, orgId, body());
    expect(legacy.runtimes).toBeNull();
    expect(await stored()).toHaveLength(1);

    const node: ScanRuntime = { name: "node", version: "22", source: ".nvmrc" };
    await ingestScan(db, orgId, body([node]));
    expect(await stored()).toEqual([
      { name: "node", version: "22", normalized: null, source: ".nvmrc" },
    ]);

    await ingestScan(db, orgId, body([php]));
    const stack = (await loadOrgStacks(db)).find((s) => s.orgId === orgId);
    const repo = await withOrg(db, orgId).repo.findFirstOrThrow({ where: { name: repoName } });
    expect(stack?.runtimes.get("php")).toEqual({
      name: "php",
      versions: new Set(["8.3"]),
      repoIds: new Set([repo.id]),
    });
    expect(stack?.runtimes.has("node")).toBe(false);
  });
});

describe.skipIf(!url)("scan ingest of Composer dependencies against Postgres", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  const repoName = `acme/shop-${suffix}`;
  const composerName = `acme/http-kernel-${suffix}`;
  const feed = `https://github.com/acme/http-kernel-${suffix}/releases.atom`;
  let orgId = "";

  beforeAll(async () => {
    orgId = (await db.org.create({ data: { name: `c-${suffix}` } })).id;
  });

  afterAll(async () => {
    await db.org.deleteMany({ where: { id: orgId } });
    await db.package.deleteMany({ where: { name: { endsWith: suffix } } });
    await db.$disconnect();
  });

  it("stores Packagist packages apart from npm ones and maps their release feed", async () => {
    const [result] = await ingestScan(db, orgId, {
      source: "github",
      repos: [
        {
          name: repoName,
          ecosystem: "npm",
          dependencies: [
            { name: `kernel-${suffix}`, version: "6.4.3", direct: true },
            { name: composerName, version: "6.4.3", direct: true, ecosystem: "Packagist" },
            {
              name: `Acme/Log-${suffix}`,
              version: "3.0.2",
              direct: false,
              ecosystem: "Packagist",
            },
            {
              name: `acme/test-runner-${suffix}`,
              version: "10.5.9",
              direct: true,
              ecosystem: "Packagist",
              dev: true,
            },
          ],
        },
      ],
    });
    expect(result).toMatchObject({ created: true, dependencies: 4, direct: 3 });

    const rows = await withOrg(db, orgId).dependency.findMany({
      select: {
        installedVersion: true,
        direct: true,
        dev: true,
        package: { select: { ecosystem: true, name: true } },
      },
      orderBy: { package: { name: "asc" } },
    });
    expect(
      rows.map((r) => [r.package.ecosystem, r.package.name, r.installedVersion, r.direct, r.dev])
    ).toEqual([
      ["Packagist", `acme/http-kernel-${suffix}`, "6.4.3", true, false],
      ["Packagist", `acme/log-${suffix}`, "3.0.2", false, false],
      ["Packagist", `acme/test-runner-${suffix}`, "10.5.9", true, true],
      ["npm", `kernel-${suffix}`, "6.4.3", true, false],
    ]);

    await db.package.update({
      where: { ecosystem_name: { ecosystem: "Packagist", name: composerName } },
      data: { releaseFeedUrl: feed },
    });
    const stack = (await loadOrgStacks(db, [orgId]))[0];
    expect(stack.packages.get(`Packagist:${composerName}`)?.ecosystem).toBe("Packagist");
    expect(stack.packages.get(`kernel-${suffix}`)?.ecosystem).toBe("npm");
    const match = matchItem(
      { title: "v6.4.4", rawText: "" },
      { kind: "github_releases", url: feed, serviceKey: null, traits: [], runtime: null },
      stack
    );
    const pkg = await db.package.findUniqueOrThrow({
      where: { ecosystem_name: { ecosystem: "Packagist", name: composerName } },
    });
    expect(match).toMatchObject({ packageId: pkg.id, reason: `release:${composerName}` });
  });
});

describe.skipIf(!url)("scan ingest of PyPI dependencies against Postgres", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  let orgId = "";

  beforeAll(async () => {
    orgId = (await db.org.create({ data: { name: `py-${suffix}` } })).id;
  });

  afterAll(async () => {
    await db.org.deleteMany({ where: { id: orgId } });
    await db.package.deleteMany({ where: { name: { endsWith: suffix } } });
    await db.$disconnect();
  });

  it("stores PEP 503 names, the tool and unresolved requirements", async () => {
    const [result] = await ingestScan(db, orgId, {
      source: "local",
      repos: [
        {
          name: `acme/jobs-${suffix}`,
          ecosystem: "npm",
          dependencies: [
            {
              name: `Acme_HTTP_${suffix}`,
              version: "2.31.0",
              direct: true,
              ecosystem: "PyPI",
              manager: "uv",
            },
            {
              name: `acme-orm-${suffix}`,
              version: "~=2.0",
              direct: true,
              ecosystem: "PyPI",
              manager: "pip",
              unresolved: true,
            },
            // The same name in npm stays its own package.
            { name: `acme-http-${suffix}`, version: "1.0.0", direct: true },
          ],
        },
      ],
    });
    expect(result).toMatchObject({ dependencies: 3, direct: 3 });
    const rows = await withOrg(db, orgId).dependency.findMany({
      select: {
        installedVersion: true,
        manager: true,
        unresolved: true,
        package: { select: { ecosystem: true, name: true } },
      },
      orderBy: [{ package: { ecosystem: "asc" } }, { package: { name: "asc" } }],
    });
    expect(
      rows.map((r) => [
        r.package.ecosystem,
        r.package.name,
        r.installedVersion,
        r.manager,
        r.unresolved,
      ])
    ).toEqual([
      ["PyPI", `acme-http-${suffix}`, "2.31.0", "uv", false],
      ["PyPI", `acme-orm-${suffix}`, "~=2.0", "pip", true],
      ["npm", `acme-http-${suffix}`, "1.0.0", null, false],
    ]);
    const stack = (await loadOrgStacks(db, [orgId]))[0];
    expect(stack.packages.get(`PyPI:acme-http-${suffix}`)?.ecosystem).toBe("PyPI");
    expect(stack.packages.get(`acme-http-${suffix}`)?.ecosystem).toBe("npm");
  });
});

describe.skipIf(!url)("scan ingest of Go modules against Postgres", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  const kit = `github.com/acme/kit-${suffix}/v2`;
  let orgId = "";

  beforeAll(async () => {
    orgId = (await db.org.create({ data: { name: `go-${suffix}` } })).id;
  });

  afterAll(async () => {
    await db.org.deleteMany({ where: { id: orgId } });
    await db.package.deleteMany({ where: { name: { contains: suffix } } });
    await db.$disconnect();
  });

  it("stores module paths as written, case included, with the release feed of their repo", async () => {
    await ingestScan(db, orgId, {
      source: "github",
      repos: [
        {
          name: `acme/jobs-${suffix}`,
          ecosystem: "npm",
          dependencies: [
            { name: kit, version: "2.4.1", direct: true, ecosystem: "Go" },
            {
              name: `github.com/Acme/Legacy-${suffix}`,
              version: "1.2.0+incompatible",
              direct: false,
              ecosystem: "Go",
            },
          ],
        },
      ],
    });
    const rows = await withOrg(db, orgId).dependency.findMany({
      select: {
        installedVersion: true,
        direct: true,
        package: { select: { ecosystem: true, name: true } },
      },
      orderBy: { package: { name: "asc" } },
    });
    expect(
      rows.map((r) => [r.package.ecosystem, r.package.name, r.installedVersion, r.direct])
    ).toEqual([
      ["Go", `github.com/Acme/Legacy-${suffix}`, "1.2.0+incompatible", false],
      ["Go", kit, "2.4.1", true],
    ]);
    const feed = `https://github.com/acme/kit-${suffix}/releases.atom`;
    await db.package.update({
      where: { ecosystem_name: { ecosystem: "Go", name: kit } },
      data: { releaseFeedUrl: feed },
    });
    const stack = (await loadOrgStacks(db, [orgId]))[0];
    const match = matchItem(
      { title: "v2.5.0", rawText: "" },
      { kind: "github_releases", url: feed, serviceKey: null, traits: [], runtime: null },
      stack
    );
    expect(match?.reason).toBe(`release:${kit}`);
  });
});

describe.skipIf(!url)("RubyGems ingest", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  let orgId = "";
  beforeAll(async () => {
    orgId = (await db.org.create({ data: { name: `acme-ruby-${suffix}` } })).id;
  });
  afterAll(async () => {
    await db.org.deleteMany({ where: { id: orgId } });
    await db.package.deleteMany({ where: { name: `acme-gem-${suffix}` } });
    await db.$disconnect();
  });
  it("stores RubyGems separately from npm and retains development declarations", async () => {
    const name = `acme-gem-${suffix}`;
    await ingestScan(db, orgId, {
      source: "github",
      repos: [
        {
          name: "acme/api",
          ecosystem: "npm",
          dependencies: [
            { name, version: "1.2.3", direct: true, dev: true, ecosystem: "RubyGems" },
            { name, version: "4.5.6", direct: false },
          ],
        },
      ],
    });
    const rows = await withOrg(db, orgId).dependency.findMany({
      select: {
        installedVersion: true,
        direct: true,
        dev: true,
        package: { select: { ecosystem: true } },
      },
      orderBy: { installedVersion: "asc" },
    });
    expect(rows.map((r) => [r.package.ecosystem, r.installedVersion, r.direct, r.dev])).toEqual([
      ["RubyGems", "1.2.3", true, true],
      ["npm", "4.5.6", false, false],
    ]);
  });
});

describe.skipIf(!url)("crates.io ingest", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  let orgId = "";
  beforeAll(async () => {
    orgId = (await db.org.create({ data: { name: `acme-cargo-${suffix}` } })).id;
  });
  afterAll(async () => {
    await db.org.deleteMany({ where: { id: orgId } });
    await db.package.deleteMany({ where: { name: `acme-crate-${suffix}` } });
    await db.$disconnect();
  });
  it("stores crates.io separately from npm and retains development declarations", async () => {
    const name = `acme-crate-${suffix}`;
    await ingestScan(db, orgId, {
      source: "github",
      repos: [
        {
          name: "acme/api",
          ecosystem: "npm",
          dependencies: [
            { name, version: "1.2.3", direct: true, dev: true, ecosystem: "crates.io" },
            { name, version: "4.5.6", direct: false },
          ],
        },
      ],
    });
    const rows = await withOrg(db, orgId).dependency.findMany({
      select: {
        installedVersion: true,
        direct: true,
        dev: true,
        package: { select: { ecosystem: true } },
      },
      orderBy: { installedVersion: "asc" },
    });
    expect(rows.map((r) => [r.package.ecosystem, r.installedVersion, r.direct, r.dev])).toEqual([
      ["crates.io", "1.2.3", true, true],
      ["npm", "4.5.6", false, false],
    ]);
  });
});

describe.skipIf(!url)("Maven ingest", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  let orgId = "";
  beforeAll(async () => {
    orgId = (await db.org.create({ data: { name: `acme-maven-${suffix}` } })).id;
  });
  afterAll(async () => {
    await db.org.deleteMany({ where: { id: orgId } });
    await db.package.deleteMany({ where: { name: `org.acme:kit-${suffix}` } });
    await db.$disconnect();
  });
  it("ingests the recorded Maven scanner fixture through the real collector", async () => {
    const files = Object.fromEntries(
      ["pom.xml", "api/pom.xml"].map((file) => [
        file,
        readFileSync(
          new URL(`../../../packages/scan/src/__fixtures__/maven/${file}`, import.meta.url),
          "utf8"
        ),
      ])
    );
    const repo = await collectFromFiles("acme/maven-fixture", files, { warn: () => {} });
    expect(repo).not.toBeNull();
    if (!repo) throw new Error("fixture did not scan");
    await ingestScan(db, orgId, { source: "local", repos: [repo] });
    const rows = await withOrg(db, orgId).dependency.findMany({
      where: { repo: { name: "acme/maven-fixture" } },
      include: { package: true },
    });
    expect(rows.map((r) => [r.package.name, r.installedVersion]).sort()).toEqual([
      ["org.apache.logging.log4j:log4j-core", "2.14.1"],
      ["org.yaml:snakeyaml", "1.30"],
    ]);
  });
  it("stores Maven separately from npm and retains development declarations", async () => {
    const name = `org.acme:kit-${suffix}`;
    await ingestScan(db, orgId, {
      source: "github",
      repos: [
        {
          name: "acme/api",
          ecosystem: "npm",
          dependencies: [
            { name, version: "1.2.3", direct: true, dev: true, ecosystem: "Maven" },
            { name, version: "4.5.6", direct: false },
          ],
        },
      ],
    });
    const rows = await withOrg(db, orgId).dependency.findMany({
      where: { repo: { name: "acme/api" } },
      select: {
        installedVersion: true,
        direct: true,
        dev: true,
        package: { select: { ecosystem: true } },
      },
      orderBy: { installedVersion: "asc" },
    });
    expect(rows.map((r) => [r.package.ecosystem, r.installedVersion, r.direct, r.dev])).toEqual([
      ["Maven", "1.2.3", true, true],
      ["npm", "4.5.6", false, false],
    ]);
  });
});

describe.skipIf(!url)("NuGet ingest", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  let orgId = "";
  beforeAll(async () => {
    orgId = (await db.org.create({ data: { name: `acme-nuget-${suffix}` } })).id;
  });
  afterAll(async () => {
    await db.org.deleteMany({ where: { id: orgId } });
    await db.package.deleteMany({ where: { name: `acme.kit-${suffix}` } });
    await db.$disconnect();
  });
  it("retains conditional guidance through collector and tenant ingest", async () => {
    const files = Object.fromEntries(
      ["Acme.csproj", "Directory.Packages.props"].map((file) => [
        file,
        readFileSync(
          new URL(
            `../../../packages/scan/src/__fixtures__/nuget-conditional/${file}`,
            import.meta.url
          ),
          "utf8"
        ),
      ])
    );
    const repo = await collectFromFiles("acme/nuget-conditional", files, { warn: () => {} });
    if (!repo) throw new Error("fixture did not scan");
    await ingestScan(db, orgId, { source: "local", repos: [repo] });
    const rows = await withOrg(db, orgId).dependency.findMany({
      where: { repo: { name: "acme/nuget-conditional" }, package: { name: "system.text.json" } },
      orderBy: { installedVersion: "asc" },
    });
    expect(rows.map((row) => [row.installedVersion, row.requirement])).toEqual([
      ["8.0.0", "nuget-conditional"],
      ["9.0.0", "nuget-conditional"],
    ]);
  });
  it("ingests the recorded NuGet scanner fixture through the real collector", async () => {
    const files = Object.fromEntries(
      [
        "Directory.Packages.props",
        "api/Acme.Api.csproj",
        "locked/Acme.Worker.csproj",
        "locked/packages.lock.json",
      ].map((file) => [
        file,
        readFileSync(
          new URL(`../../../packages/scan/src/__fixtures__/nuget/${file}`, import.meta.url),
          "utf8"
        ),
      ])
    );
    const repo = await collectFromFiles("acme/nuget-fixture", files, { warn: () => {} });
    expect(repo).not.toBeNull();
    if (!repo) throw new Error("fixture did not scan");
    await ingestScan(db, orgId, { source: "local", repos: [repo] });
    const rows = await withOrg(db, orgId).dependency.findMany({
      where: { repo: { name: "acme/nuget-fixture" } },
      include: { package: true },
    });
    expect(rows.map((r) => [r.package.name, r.installedVersion]).sort()).toEqual([
      ["newtonsoft.json", "12.0.1"],
      ["system.net.http", "4.3.0"],
      ["system.text.encodings.web", "4.5.1"],
    ]);
  });
});

describe.skipIf(!url)("SwiftPM ingest", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  let orgId = "";
  beforeAll(async () => {
    orgId = (await db.org.create({ data: { name: `acme-swift-${Date.now()}` } })).id;
  });
  afterAll(async () => {
    await db.org.deleteMany({ where: { id: orgId } });
    await db.$disconnect();
  });
  it("stores normalized repository identities through the real collector", async () => {
    const files = Object.fromEntries(
      ["Package.resolved", "Package.swift"].map((file) => [
        file,
        readFileSync(
          new URL(`../../../packages/scan/src/__fixtures__/swiftpm/${file}`, import.meta.url),
          "utf8"
        ),
      ])
    );
    const repo = await collectFromFiles("acme/swift", files, {
      warn: (message) => {
        throw new Error(message);
      },
    });
    if (!repo) throw new Error("fixture did not scan");
    await ingestScan(db, orgId, { source: "local", repos: [repo] });
    const rows = await withOrg(db, orgId).dependency.findMany({
      include: { package: true },
      orderBy: { package: { name: "asc" } },
    });
    expect(
      rows.map((row) => [
        row.package.ecosystem,
        row.package.name,
        row.installedVersion,
        row.direct,
        row.project,
      ])
    ).toEqual([
      ["SwiftURL", "github.com/apple/swift-nio", "2.40.0", false, null],
      ["SwiftURL", "github.com/vapor/vapor", "4.50.0", true, "Package.swift"],
    ]);
  });
});
