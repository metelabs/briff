import { describe, expect, it } from "vitest";

import { strings } from "@/lib/i18n";

import {
  actionClauses,
  actionsForRepo,
  alertActionsForRepo,
  groupByRepo,
  repoAnchor,
  repoFixLines,
  upgradeActions,
} from "./bulletin-by-repo";
import type { BulletinViewAlert, BulletinViewItem } from "./bulletin-view";
import { packageUpgrades } from "./upgrades";
import { W43_ALERT_FIXES } from "./__fixtures__/w43-security";

const t = strings("en");

function item(over: Partial<BulletinViewItem> & { itemId: string }): BulletinViewItem {
  return {
    bucket: "breaking_or_feature",
    headline: over.itemId,
    line: "",
    action: "",
    todo: null,
    title: over.itemId,
    url: "https://example.com",
    sourceName: "src",
    affectedRepos: [],
    dueAt: null,
    folded: [],
    upgrades: [],
    ...over,
  };
}

function alert(over: Partial<BulletinViewAlert> & { packageName: string }): BulletinViewAlert {
  return {
    severity: "HIGH",
    osvIds: ["GHSA-1"],
    repos: [],
    fixed: null,
    noLineFix: false,
    transitive: false,
    installs: [],
    ...over,
  };
}

describe("actionsForRepo", () => {
  it("applies a single command to every affected repo", () => {
    expect(actionsForRepo("npm i better-auth@1.7.12", "briff", ["briff", "x"])).toEqual([
      { kind: "command", text: "npm i better-auth@1.7.12" },
    ]);
  });

  it("splits per release line commands by their repo lists", () => {
    const action =
      "npm i next@15.5.9 (budget) · npm i next@14.2.35 (tracker, pantheon) · transitive: mailer";
    const repos = ["budget", "tracker", "pantheon", "mailer"];
    expect(actionsForRepo(action, "pantheon", repos)).toEqual([
      { kind: "command", text: "npm i next@14.2.35" },
    ]);
    expect(actionsForRepo(action, "budget", repos)).toEqual([
      { kind: "command", text: "npm i next@15.5.9" },
    ]);
    // Transitive-only repos get no command (the update belongs to what pulls it in).
    expect(actionsForRepo(action, "mailer", repos)).toEqual([]);
  });

  it("splits runtime clauses that start with the repo name", () => {
    const action =
      "garden.example: rebuild to pick up PHP 8.3.36; the php:8.3-fpm tag already points to it · yard: set node 22.23.4 in .nvmrc";
    expect(actionsForRepo(action, "yard", ["garden.example", "yard"])).toEqual([
      { kind: "text", text: "set node 22.23.4 in .nvmrc" },
    ]);
  });

  it("keeps a sentence whole for every repo", () => {
    const sentence = "undici is a transitive dependency: update the packages that pull it in.";
    expect(actionsForRepo(sentence, "briff", ["briff"])).toEqual([
      { kind: "text", text: sentence },
    ]);
  });
});

describe("groupByRepo", () => {
  const view = {
    act: [
      item({
        itemId: "a1",
        bucket: "security",
        headline: "undici 8.12.2 fixes TLS validation",
        affectedRepos: ["briff", "yard"],
        action: "npm i undici@8.12.2",
        upgrades: [
          { repo: "briff", name: "undici", installed: ["8.10.0"], target: "8.12.2" },
          { repo: "yard", name: "undici", installed: [], target: "8.12.2" },
        ],
      }),
      item({ itemId: "a2", bucket: "deadline", headline: "Deadline", affectedRepos: ["yard"] }),
    ],
    know: [
      item({ itemId: "k1", todo: "read", headline: "msw 3 is ESM-only", affectedRepos: ["briff"] }),
      item({ itemId: "k2", todo: "wait", headline: "TypeScript 7.1 Beta" }),
    ],
    alerts: [
      alert({
        packageName: "vite",
        repos: ["garden.example"],
        fixed: "6.4.1",
        osvIds: ["a", "b"],
        installs: [{ repo: "garden.example", name: "vite", installed: ["6.3.0"], target: "6.4.1" }],
      }),
    ],
  };

  it("regroups the same items per repo, security first, whole-stack items last", () => {
    const groups = groupByRepo(view, t);
    // briff and yard tie on security and entry count, so the name decides.
    expect(groups.map((g) => g.repo)).toEqual(["briff", "yard", "garden.example", null]);
    expect(groups[1]).toMatchObject({ repo: "yard", securityCount: 1 });
    expect(groups[1].entries.map((e) => [e.key, e.kind])).toEqual([
      ["a1", "security"],
      ["a2", "deadline"],
    ]);
    expect(groups[0].entries.map((e) => e.kind)).toEqual(["security", "read"]);
    expect(groups[3].entries).toEqual([
      {
        key: "k2",
        section: "know",
        kind: "wait",
        title: "TypeScript 7.1 Beta",
        actions: [],
        upgrades: [],
      },
    ]);
  });

  it("gives a repo without a target on its line no copy of the item's command", () => {
    const groups = groupByRepo(
      {
        act: [
          item({
            itemId: "payload",
            bucket: "security",
            headline: "Payload 3.92.0 fixes an access-control bypass",
            affectedRepos: ["bakery.example", "clinic.example"],
            action: "npm i payload@3.92.0",
            upgrades: [
              { repo: "bakery.example", name: "payload", installed: ["2.32.3"], target: null },
              { repo: "clinic.example", name: "payload", installed: ["3.86.0"], target: "3.92.0" },
            ],
          }),
        ],
        know: [],
        alerts: [],
      },
      t
    );
    const actions = (repo: string) => groups.find((g) => g.repo === repo)?.entries[0].actions;
    expect(actions("clinic.example")).toEqual([
      { kind: "command", text: "npm i payload@3.92.0", own: true },
    ]);
    expect(actions("bakery.example")).toEqual([]);
  });

  it("carries the act command per repo and the advisory's fix text", () => {
    const groups = groupByRepo(view, t);
    const briff = groups.find((g) => g.repo === "briff")?.entries[0];
    expect(briff?.actions).toEqual([{ kind: "command", text: "npm i undici@8.12.2", own: true }]);
    // Only this repo's installed version, never another repo's.
    expect(briff?.upgrades).toEqual([
      { repo: "briff", name: "undici", installed: ["8.10.0"], target: "8.12.2" },
    ]);
    expect(groups.find((g) => g.repo === "garden.example")?.entries[0]).toEqual({
      key: "alert:vite",
      section: "act",
      kind: "security",
      title: "vite: 2 new advisories, high",
      actions: [{ kind: "command", text: "npm i vite@6.4.1", own: true }],
      upgrades: [{ repo: "garden.example", name: "vite", installed: ["6.3.0"], target: "6.4.1" }],
    });
  });

  it("never lists one item twice in a repo", () => {
    const dup = { ...view, know: [...view.know, view.know[0]] };
    const briff = groupByRepo(dup, t).find((g) => g.repo === "briff");
    expect(briff?.entries.map((e) => e.key)).toEqual(["a1", "k1"]);
  });
});

describe("per-repo actions", () => {
  const nodeUpgrades = [
    {
      repo: "garden.example",
      name: "node",
      installed: ["22.17.0"],
      source: "Dockerfile",
      target: "22.23.4",
      action: "move Dockerfile to node:22.23.4-alpine",
    },
    {
      repo: "yard",
      name: "node",
      installed: ["22.17.0"],
      source: ".nvmrc",
      target: "22.23.4",
      action: "set node 22.23.4 in .nvmrc",
    },
    {
      repo: "sigma/tracker",
      name: "node",
      installed: ["22.23.4"],
      source: "Dockerfile",
      target: null,
      unaffected: true,
    },
  ];
  const summary = item({
    itemId: "node",
    bucket: "security",
    headline: "Node.js security releases",
    affectedRepos: ["garden.example", "yard", "sigma/tracker"],
    action: "Update Node.js to 22.23.4 in 2 repos (see the advisory).",
    upgrades: nodeUpgrades,
  });

  it("gives each repo card its own runtime step instead of the summary", () => {
    const groups = groupByRepo({ act: [summary], know: [], alerts: [] }, t);
    const actions = (repo: string) => groups.find((g) => g.repo === repo)?.entries[0].actions;
    expect(actions("garden.example")).toEqual([
      { kind: "text", text: "move Dockerfile to node:22.23.4-alpine", own: true },
    ]);
    expect(actions("yard")).toEqual([
      { kind: "text", text: "set node 22.23.4 in .nvmrc", own: true },
    ]);
    // No step of its own: the item's action as before.
    expect(actions("sigma/tracker")).toEqual([
      { kind: "text", text: "Update Node.js to 22.23.4 in 2 repos (see the advisory)." },
    ]);
  });

  it("lists each repo's step under a summarised By item action", () => {
    expect(repoFixLines(summary).map((l) => [l.upgrade.repo, l.action?.text ?? null])).toEqual([
      ["garden.example", "move Dockerfile to node:22.23.4-alpine"],
      ["yard", "set node 22.23.4 in .nvmrc"],
      ["sigma/tracker", null],
    ]);
  });

  it("adds nothing per line when the action already spells out every repo", () => {
    const full = {
      ...summary,
      action:
        "garden.example: move Dockerfile to node:22.23.4-alpine · yard: set node 22.23.4 in .nvmrc",
    };
    expect(repoFixLines(full).every((l) => l.action === null)).toBe(true);
  });

  it("derives install commands for direct packages only", () => {
    expect(
      upgradeActions([
        { repo: "a", name: "undici", installed: ["8.10.0"], target: "8.12.3" },
        { repo: "a", name: "undici", installed: ["7.1.0"], target: null },
        { repo: "a", name: "undici", installed: ["6.0.0"], target: "6.21.3", transitive: true },
      ])
    ).toEqual([{ kind: "command", text: "npm i undici@8.12.3", own: true }]);
    expect(
      upgradeActions([
        {
          repo: "a",
          name: "acme/log",
          ecosystem: "Packagist",
          installed: ["3.0.2"],
          target: "3.0.3",
        },
      ])
    ).toEqual([{ kind: "command", text: "composer require acme/log:^3.0.3", own: true }]);
    expect(
      upgradeActions([
        {
          repo: "a",
          name: "acme/test-runner",
          ecosystem: "Packagist",
          dev: true,
          installed: ["10.5.9"],
          target: "10.5.10",
        },
      ])
    ).toEqual([
      { kind: "command", text: "composer require --dev acme/test-runner:^10.5.10", own: true },
    ]);
    expect(
      upgradeActions([
        {
          repo: "a",
          name: "acme-http",
          ecosystem: "PyPI",
          manager: "uv",
          installed: ["2.31.0"],
          target: "2.32.0",
        },
      ])
    ).toEqual([{ kind: "command", text: "uv add acme-http==2.32.0", own: true }]);
  });

  it("keeps the advisory's fix text for a transitive package", () => {
    const groups = groupByRepo(
      {
        act: [],
        know: [],
        alerts: [
          alert({
            packageName: "undici",
            repos: ["a"],
            transitive: true,
            fixed: "8.12.3",
            installs: [
              { repo: "a", name: "undici", installed: ["8.10.0"], target: null, transitive: true },
            ],
          }),
        ],
      },
      t
    );
    expect(groups[0].entries[0].actions).toEqual([{ kind: "text", text: "Fixed in 8.12.3" }]);
  });

  it("puts a know item's install command before its next step", () => {
    const groups = groupByRepo(
      {
        act: [],
        know: [
          item({
            itemId: "k",
            todo: "upgrade",
            action: "with the next deploy",
            affectedRepos: ["a"],
            upgrades: [{ repo: "a", name: "vite", installed: ["6.3.0"], target: "6.4.1" }],
          }),
        ],
        alerts: [],
      },
      t
    );
    expect(groups[0].entries[0]).toMatchObject({
      section: "know",
      actions: [
        { kind: "command", text: "npm i vite@6.4.1", own: true },
        { kind: "text", text: "with the next deploy" },
      ],
    });
  });
});

describe("actionClauses", () => {
  it("gives each release line its own command and keeps the transitive note", () => {
    expect(
      actionClauses("npm i next@15.5.9 (budget) · npm i next@14.2.35 (a, b) · transitive: c")
    ).toEqual([
      { kind: "command", command: "npm i next@15.5.9", repos: ["budget"] },
      { kind: "command", command: "npm i next@14.2.35", repos: ["a", "b"] },
      { kind: "text", text: "transitive: c" },
    ]);
  });

  it("keeps sentences and runtime clauses as one text", () => {
    const runtime =
      "yard: set node 22.23.4 in .nvmrc · garden.example: move Dockerfile to node:22.23.4";
    expect(actionClauses(runtime)).toEqual([{ kind: "text", text: runtime }]);
    expect(actionClauses("npm i a@1")).toEqual([
      { kind: "command", command: "npm i a@1", repos: [] },
    ]);
    expect(actionClauses("")).toEqual([]);
  });
});

describe("review fixes", () => {
  it("keeps the shared waiting sentence for the repos it names next to EOL clauses", () => {
    const action =
      "Update Node.js in briff, garden.example as soon as the fixed release is out (announced for 21 Oct 2026). · orchid-hotel.example: node 14 is end-of-life and will not get this fix; move to 22 or later";
    const repos = ["briff", "garden.example", "orchid-hotel.example"];
    expect(actionsForRepo(action, "briff", repos)).toEqual([
      {
        kind: "text",
        text: "Update Node.js in briff, garden.example as soon as the fixed release is out (announced for 21 Oct 2026).",
      },
    ]);
    expect(actionsForRepo(action, "orchid-hotel.example", repos)).toEqual([
      {
        kind: "text",
        text: "node 14 is end-of-life and will not get this fix; move to 22 or later",
      },
    ]);
  });

  it("gives an uncovered repo a shared sentence that names no repo", () => {
    const action = "Read the advisory before the next deploy. · a: set node 22.23.4 in .nvmrc";
    expect(actionsForRepo(action, "b", ["a", "b"])).toEqual([
      { kind: "text", text: "Read the advisory before the next deploy." },
    ]);
    expect(actionsForRepo(action, "a", ["a", "b"])).toEqual([
      { kind: "text", text: "set node 22.23.4 in .nvmrc" },
    ]);
  });

  it("gives each repo only its own release line's fix", () => {
    const line = alert({
      packageName: "next",
      repos: ["a", "b"],
      fixed: "15.5.9 (a) · 14.2.35 (b, c)",
    });
    expect(alertActionsForRepo(line, "b", t)).toEqual([{ kind: "text", text: "Fixed in 14.2.35" }]);
    expect(alertActionsForRepo(line, "a", t)).toEqual([{ kind: "text", text: "Fixed in 15.5.9" }]);
    expect(alertActionsForRepo(line, "z", t)).toEqual([]);
  });

  it("carries a know item's next step into its repo cards", () => {
    const groups = groupByRepo(
      {
        act: [],
        know: [
          item({
            itemId: "k",
            todo: "upgrade",
            action: "with the next deploy",
            affectedRepos: ["a"],
          }),
        ],
        alerts: [],
      },
      t
    );
    expect(groups[0].entries[0].actions).toEqual([{ kind: "text", text: "with the next deploy" }]);
  });
});

describe("repoAnchor", () => {
  it("never gives two repos the same id", () => {
    const repos = [
      "org/tool",
      "org_tool",
      "org-tool",
      "org-2f-tool",
      "garden.example",
      "garden-2e-example",
    ];
    const ids = repos.map(repoAnchor);
    expect(new Set(ids).size).toBe(repos.length);
    expect(repoAnchor("org/tool")).toBe("repo-org-2f-tool");
    expect(repoAnchor("org_tool")).toBe("repo-org_tool");
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("groupByRepo for a fix command with a line that has no fix (W43 nodemailer)", () => {
  it("gives the fixed line its command and the other line the advisory", () => {
    const action =
      "npm i nodemailer@10.1.4 (briff) · 9.x has no known fix, read the advisory: " +
      "garden.example, west.garden.example · transitive: mint-app, pantheon";
    const groups = groupByRepo(
      {
        act: [
          item({
            itemId: "nodemailer",
            bucket: "security",
            action,
            affectedRepos: [
              "briff",
              "garden.example",
              "mint-app",
              "pantheon",
              "west.garden.example",
            ],
            upgrades: packageUpgrades(
              "nodemailer",
              "10.1.2",
              W43_ALERT_FIXES.get("nodemailer") ?? []
            ),
          }),
        ],
        know: [],
        alerts: [],
      },
      t
    );
    const actions = (repo: string) =>
      groups.find((g) => g.repo === repo)?.entries[0].actions.map((a) => a.text);
    expect(actions("briff")).toEqual(["npm i nodemailer@10.1.4"]);
    expect(actions("garden.example")).toEqual([
      "9.x has no known fix, read the advisory: garden.example, west.garden.example",
    ]);
  });
});

describe("actionClauses with a line that has no fix", () => {
  it("keeps the install command as a command and the advisory clause as text", () => {
    expect(
      actionClauses(
        "npm i nodemailer@10.1.4 (briff) · 9.x has no known fix, read the advisory: " +
          "garden.example, west.garden.example · transitive: mint-app, pantheon"
      )
    ).toEqual([
      { kind: "command", command: "npm i nodemailer@10.1.4", repos: ["briff"] },
      {
        kind: "text",
        text: "9.x has no known fix, read the advisory: garden.example, west.garden.example",
      },
      { kind: "text", text: "transitive: mint-app, pantheon" },
    ]);
  });
});

describe("actionClauses with a version that has no semver form", () => {
  it("reads its no-fix clause as text next to the command", () => {
    expect(
      actionClauses(
        "composer require acme/log:^2.0.1 (acme/shop) · 2.0.0.1 has no known fix, read the advisory: acme/legacy"
      )
    ).toEqual([
      { kind: "command", command: "composer require acme/log:^2.0.1", repos: ["acme/shop"] },
      { kind: "text", text: "2.0.0.1 has no known fix, read the advisory: acme/legacy" },
    ]);
  });
});

describe("upgradeActions for two declarations of one line", () => {
  it("renders a command per declaration", () => {
    const upgrades = packageUpgrades("acme-probe", null, [
      {
        repo: "a",
        installed: "1.0.0",
        fix: "1.0.2",
        ecosystem: "PyPI",
        manager: "uv",
        requirement: '.\tacme-probe; sys_platform == "linux"',
      },
      {
        repo: "a",
        installed: "1.0.1",
        fix: "1.0.2",
        ecosystem: "PyPI",
        manager: "uv",
        requirement: '.\tacme-probe; sys_platform == "win32"',
      },
    ]);
    expect(upgradeActions(upgrades).map((a) => a.text)).toEqual([
      `uv add 'acme-probe==1.0.2; sys_platform == "linux"'`,
      `uv add 'acme-probe==1.0.2; sys_platform == "win32"'`,
    ]);
  });
});

describe("upgradeActions with declarations on two release lines", () => {
  it("commands only the line the target belongs to", () => {
    expect(
      upgradeActions([
        {
          repo: "a",
          name: "acme-probe",
          ecosystem: "PyPI",
          manager: "uv",
          dev: true,
          group: "test",
          installed: ["1.0.0"],
          target: "2.0.1",
        },
        {
          repo: "a",
          name: "acme-probe",
          ecosystem: "PyPI",
          manager: "uv",
          installed: ["2.0.0"],
          target: "2.0.1",
        },
      ]).map((a) => a.text)
    ).toEqual(["uv add acme-probe==2.0.1"]);
  });
});
