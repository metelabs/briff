import { describe, expect, it } from "vitest";

import { fixCommand, fixVersions, lineFixes, recommendFixes, releaseLine } from "./fixes";
import { packageUpgrades } from "./upgrades";

describe("releaseLine", () => {
  it("is the major, or 0.minor below 1.0", () => {
    expect(releaseLine("8.12.2")).toBe("8");
    expect(releaseLine("0.4.1")).toBe("0.4");
  });
});

describe("fixCommand", () => {
  it("gives the same version for the same release in two streams (better-auth)", () => {
    const sigma = [
      { repo: "tracker", installed: "1.4.9", fix: "1.6.22" },
      { repo: "budget", installed: "1.6.23", fix: "1.7.10" },
    ];
    const acme = [{ repo: "briff", installed: "1.7.9", fix: "1.7.10" }];
    expect(fixCommand("better-auth", "1.7.12", sigma)).toBe("npm i better-auth@1.7.12");
    expect(fixCommand("better-auth", "1.7.12", acme)).toBe("npm i better-auth@1.7.12");
  });

  it("prefers the item's release over an older OSV fix (fastify)", () => {
    const repos = [{ repo: "garden", installed: "5.8.5", fix: "5.12.5" }];
    expect(fixCommand("fastify", "5.12.6", repos)).toBe("npm i fastify@5.12.6");
  });

  it("keeps a higher resolved fix over an older release", () => {
    const repos = [{ repo: "garden", installed: "5.8.5", fix: "5.12.7" }];
    expect(fixCommand("fastify", "5.12.6", repos)).toBe("npm i fastify@5.12.7");
  });

  it("lists one command per installed line and does not force a major upgrade", () => {
    const repos = [
      { repo: "pantheon", installed: "8.10.0", fix: "8.10.2" },
      { repo: "budget", installed: "8.11.1", fix: "8.12.2" },
      { repo: "tracker", installed: "7.22.0", fix: "7.30.1" },
    ];
    expect(fixCommand("undici", "8.12.2", repos)).toBe(
      "npm i undici@8.12.2 (budget, pantheon) · npm i undici@7.30.1 (tracker)"
    );
    // Same installed lines in another stream: same versions.
    expect(fixCommand("undici", "8.12.2", [repos[0]])).toBe("npm i undici@8.12.2");
  });

  it("merges lines that land on the same version", () => {
    const repos = [
      { repo: "a", installed: "2.0.0", fix: "2.0.1" },
      { repo: "b", installed: "2.0.0", fix: "2.0.1" },
    ];
    expect(recommendFixes(null, repos)).toEqual([{ version: "2.0.1", repos: ["a", "b"] }]);
  });

  it("never uses a fix or release on a higher line than the installed one", () => {
    expect(
      fixCommand("fastify", "6.0.1", [{ repo: "a", installed: "5.8.5", fix: "6.0.0" }])
    ).toBeNull();
    const twoAdvisories = [
      { repo: "a", installed: "5.8.5", fix: "5.12.5" },
      { repo: "a", installed: "5.8.5", fix: "6.0.0" },
    ];
    expect(fixCommand("fastify", null, twoAdvisories)).toBe("npm i fastify@5.12.5");
    expect(recommendFixes(null, twoAdvisories)).toEqual([{ version: "5.12.5", repos: ["a"] }]);
  });

  it("uses the release on the line when OSV did not resolve a fix", () => {
    const repos = [{ repo: "a", installed: "5.8.5", fix: null }];
    expect(fixCommand("fastify", "5.12.6", repos)).toBe("npm i fastify@5.12.6");
    expect(fixCommand("fastify", "6.0.0", repos)).toBeNull();
    expect(fixCommand("fastify", null, repos)).toBeNull();
  });

  it("ignores pre-releases and releases older than an installed version", () => {
    const repos = [{ repo: "a", installed: "5.8.5", fix: "5.9.0" }];
    expect(fixCommand("fastify", "5.12.6-rc.1", repos)).toBe("npm i fastify@5.9.0");
    expect(fixCommand("fastify", "5.8.0", repos)).toBe("npm i fastify@5.9.0");
  });

  it("returns null without repos, with an unparsable installed version, or when too long", () => {
    expect(fixCommand("x", "1.0.0", [])).toBeNull();
    expect(
      fixCommand("x", "1.0.1", [{ repo: "a", installed: "workspace:*", fix: "1.0.1" }])
    ).toBeNull();
    const many = Array.from({ length: 12 }, (_, i) => ({
      repo: `repository-with-a-long-name-${i}`,
      installed: `${i + 1}.0.0`,
      fix: `${i + 1}.0.1`,
    }));
    expect(fixCommand("some-package", null, many)).toBeNull();
  });
});

describe("fixCommand for transitive dependencies", () => {
  it("gives no command when every repo has the package only transitively", () => {
    const repos = [{ repo: "briff", installed: "7.29.0", fix: "7.29.1", direct: false }];
    expect(fixCommand("undici", null, repos)).toBeNull();
  });

  it("commands the direct repos and names the transitive ones", () => {
    const repos = [
      { repo: "tracker", installed: "8.9.0", fix: "8.10.2", direct: true },
      { repo: "pantheon", installed: "8.10.0", fix: "8.10.2", direct: true },
      { repo: "briff", installed: "7.29.0", fix: "7.29.1", direct: false },
    ];
    expect(fixCommand("undici", "8.12.2", repos)).toBe(
      "npm i undici@8.12.2 (pantheon, tracker) · transitive: briff"
    );
  });

  it("does not call a repo transitive when it also has the package directly", () => {
    const repos = [
      { repo: "pantheon", installed: "8.10.0", fix: "8.10.2", direct: true },
      { repo: "pantheon", installed: "7.29.0", fix: "7.29.1", direct: false },
    ];
    expect(fixCommand("undici", null, repos)).toBe("npm i undici@8.10.2");
  });
});

describe("recommendFixes with several releases", () => {
  it("uses the newest release on each installed line", () => {
    const repos = [
      { repo: "briff", installed: "10.1.0", fix: "10.1.2" },
      { repo: "yard", installed: "11.0.0", fix: null },
    ];
    expect(recommendFixes(["10.1.2", "10.1.7", "10.1.5", "11.0.1"], repos)).toEqual([
      { version: "11.0.1", repos: ["yard"] },
      { version: "10.1.7", repos: ["briff"] },
    ]);
  });

  it("ignores pre-releases and releases on a higher line", () => {
    const repos = [{ repo: "briff", installed: "10.1.0", fix: "10.1.2" }];
    expect(fixCommand("nodemailer", ["11.0.0", "10.1.9-beta.1", "10.1.3"], repos)).toBe(
      "npm i nodemailer@10.1.3"
    );
    expect(fixCommand("nodemailer", [], repos)).toBe("npm i nodemailer@10.1.2");
  });
});

describe("fixCommand per installed line when a line has no fix (W43 nodemailer)", () => {
  const nodemailer = [
    { repo: "briff", installed: "10.1.1", fix: "10.1.4", direct: true },
    { repo: "garden.example", installed: "9.0.3", fix: "10.1.4", direct: true },
    { repo: "west.garden.example", installed: "9.0.3", fix: "10.1.4", direct: true },
    { repo: "mint-app", installed: "6.9.15", fix: "10.1.4", direct: false },
    { repo: "pantheon", installed: "7.0.11", fix: "10.1.4", direct: false },
  ];

  it("commands the line that has a fix and sends the other line to the advisory", () => {
    // Used to be null for the whole item: one line without a fix voided the 10.x command.
    expect(fixCommand("nodemailer", "10.1.2", nodemailer)).toBe(
      "npm i nodemailer@10.1.4 (briff) · 9.x has no known fix, read the advisory: " +
        "garden.example, west.garden.example · transitive: mint-app, pantheon"
    );
    expect(fixVersions("10.1.2", nodemailer)).toEqual(["10.1.4"]);
    // The line rule is unchanged: alert lines and upgrades still see no safe answer.
    expect(recommendFixes("10.1.2", nodemailer.slice(0, 3))).toBeNull();
  });

  it("gives each line its own fix when the advisory has one there", () => {
    const backported = nodemailer.map((r) =>
      r.installed === "9.0.3" ? { ...r, fix: "9.0.4" } : r
    );
    expect(fixCommand("nodemailer", "10.1.2", backported)).toBe(
      "npm i nodemailer@10.1.4 (briff) · npm i nodemailer@9.0.4 (garden.example, west.garden.example)" +
        " · transitive: mint-app, pantheon"
    );
    expect(fixVersions("10.1.2", backported)).toEqual(["10.1.4", "9.0.4"]);
  });

  it("stays null when no installed line has a fix", () => {
    expect(fixCommand("nodemailer", "10.1.2", nodemailer.slice(1, 3))).toBeNull();
    expect(lineFixes("10.1.2", nodemailer.slice(1, 3))).toEqual([
      { line: "9", version: null, repos: ["garden.example", "west.garden.example"] },
    ]);
  });

  it("reads fix versions from transitive repos only when no repo has the package directly", () => {
    const transitive = [{ repo: "briff", installed: "7.29.0", fix: "7.29.1", direct: false }];
    expect(fixVersions(null, transitive)).toEqual(["7.29.1"]);
    // 6.x and 7.x are fixed only on 10.x: no version of their own line to name.
    expect(fixVersions(null, nodemailer.slice(3))).toEqual([]);
  });
});

describe("fixCommand for a release older than the fix (W43 fastify)", () => {
  it("installs the resolved fix and reports it as the fix version", () => {
    const repos = [{ repo: "garden.example", installed: "5.8.5", fix: "5.12.7", direct: true }];
    expect(fixCommand("fastify", "5.12.6", repos)).toBe("npm i fastify@5.12.7");
    expect(fixVersions("5.12.6", repos)).toEqual(["5.12.7"]);
  });
});

describe("fixCommand when the item has affected repos the command does not cover", () => {
  const repos = [{ repo: "garden.example", installed: "3.80.0", fix: "3.92.0", direct: true }];

  it("names the repos the command is for when another affected repo is left out", () => {
    // west runs payload 2.x without an alert entry: a bare command would read as covering it.
    expect(fixCommand("payload", "3.92.0", repos, undefined, ["garden.example", "west"])).toBe(
      "npm i payload@3.92.0 (garden.example)"
    );
  });

  it("keeps the bare command when it covers every affected repo", () => {
    expect(fixCommand("payload", "3.92.0", repos, undefined, ["garden.example"])).toBe(
      "npm i payload@3.92.0"
    );
    expect(fixCommand("payload", "3.92.0", repos)).toBe("npm i payload@3.92.0");
  });
});

describe("fixCommand per ecosystem", () => {
  const composer = (repo: string, installed: string, fix: string | null, direct = true) => ({
    repo,
    installed,
    fix,
    direct,
    ecosystem: "Packagist" as const,
  });

  it("uses a caret composer require that stays on the installed line", () => {
    expect(fixCommand("acme/http-kernel", null, [composer("acme/shop", "6.4.3", "6.4.4")])).toBe(
      "composer require acme/http-kernel:^6.4.4"
    );
    expect(
      fixCommand("acme/http-kernel", null, [
        composer("acme/shop", "6.4.3", "6.4.4"),
        composer("acme/legacy", "5.4.20", "5.4.46"),
        composer("acme/tools", "6.4.1", null, false),
      ])
    ).toBe(
      "composer require acme/http-kernel:^6.4.4 (acme/shop) · composer require acme/http-kernel:^5.4.46 (acme/legacy) · transitive: acme/tools"
    );
  });

  it("keeps a require-dev package in require-dev", () => {
    const dev = { ...composer("acme/shop", "10.5.9", "10.5.10"), dev: true };
    expect(fixCommand("acme/test-runner", null, [dev])).toBe(
      "composer require --dev acme/test-runner:^10.5.10"
    );
    expect(
      fixCommand("acme/test-runner", null, [dev, composer("acme/tools", "10.5.8", "10.5.10")])
    ).toBe(
      "composer require --dev acme/test-runner:^10.5.10 (acme/shop) · composer require acme/test-runner:^10.5.10 (acme/tools)"
    );
  });

  it("picks the variant per release line when one repo requires two lines differently", () => {
    expect(
      fixCommand("acme/log", null, [
        composer("acme/shop", "1.0.0", "1.0.1"),
        { ...composer("acme/shop", "2.0.0", "2.0.1"), dev: true },
      ])
    ).toBe(
      "composer require --dev acme/log:^2.0.1 (acme/shop) · composer require acme/log:^1.0.1 (acme/shop)"
    );
  });

  it("keeps the comparable lines' commands next to a version without a semver form", () => {
    const repos = [
      composer("acme/shop", "2.0.0", "2.0.1"),
      composer("acme/legacy", "2.0.0.1", null),
    ];
    expect(fixCommand("acme/log", null, repos)).toBe(
      "composer require acme/log:^2.0.1 (acme/shop) · 2.0.0.1 has no known fix, read the advisory: acme/legacy"
    );
    expect(packageUpgrades("acme/log", null, repos).map((u) => [u.repo, u.target])).toEqual([
      ["acme/legacy", null],
      ["acme/shop", "2.0.1"],
    ]);
  });

  it("never names a higher major for Composer either", () => {
    expect(fixCommand("acme/http-kernel", null, [composer("acme/shop", "5.4.20", "6.4.4")])).toBe(
      null
    );
  });
});

describe("fixCommand for PyPI", () => {
  const py = (repo: string, installed: string, fix: string, manager?: "uv" | "poetry") => ({
    repo,
    installed,
    fix,
    direct: true,
    ecosystem: "PyPI" as const,
    ...(manager ? { manager } : {}),
  });

  it("speaks the tool each repo uses, one command per tool on the same line", () => {
    expect(fixCommand("acme-http", null, [py("acme/jobs", "2.31.0", "2.32.0", "uv")])).toBe(
      "uv add acme-http==2.32.0"
    );
    expect(
      fixCommand("acme-http", null, [
        py("acme/jobs", "2.31.0", "2.32.0", "uv"),
        py("acme/api", "2.30.0", "2.32.0", "poetry"),
        py("acme/legacy", "2.28.0", "2.32.0"),
      ])
    ).toBe(
      "poetry add acme-http@2.32.0 (acme/api) · uv add acme-http==2.32.0 (acme/jobs) · pip install acme-http==2.32.0 (acme/legacy)"
    );
  });
});

describe("fixCommand for Go", () => {
  const go = (repo: string, installed: string, fix: string, direct = true) => ({
    repo,
    installed,
    fix,
    direct,
    ecosystem: "Go" as const,
  });

  it("installs the fix on the module's line with go get and the v", () => {
    expect(
      fixCommand("github.com/acme/queue", null, [
        go("acme/jobs", "1.9.0", "1.9.2"),
        go("acme/api", "1.8.0", "1.9.2", false),
      ])
    ).toBe("go get github.com/acme/queue@v1.9.2 (acme/jobs) · transitive: acme/api");
  });

  it("keeps the 0.x line rule: a fix on another minor below 1.0 is no command", () => {
    expect(fixCommand("golang.org/x/net", null, [go("acme/jobs", "0.30.0", "0.33.0")])).toBeNull();
  });
});

it("bounds RubyGems fixes to the installed major", () => {
  expect(
    fixCommand("rack", "3.1.0", [
      { repo: "acme/api", installed: "2.2.3", fix: "2.2.9", ecosystem: "RubyGems" },
    ])
  ).toBe('set rack in Gemfile to "~> 2.2.9", then run bundle update rack --conservative');
  expect(
    fixCommand("rack", "3.1.0", [
      { repo: "acme/api", installed: "2.2.3", fix: "3.0.0", ecosystem: "RubyGems" },
    ])
  ).toBeNull();
});
