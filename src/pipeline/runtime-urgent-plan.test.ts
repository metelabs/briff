import { describe, expect, it } from "vitest";

import { renderUrgentEmail } from "@/lib/email/alert-email";

import {
  handledMatchUpdate,
  planRuntimeUrgent,
  ruleTriageRows,
  runtimeMetaFor,
  selectRuntimeWork,
  type PendingRuntimeMatch,
  type StoredRuntimeMatch,
} from "./runtime-urgent-plan";

const security = { class: "security", runtime: "php", kind: "rss" };

describe("runtimeMetaFor", () => {
  it("only reads security sources with a runtime", () => {
    const post = { title: "Upcoming Critical PHP Security Release", rawText: "" };
    expect(runtimeMetaFor(security, post)?.kind).toBe("announcement");
    expect(runtimeMetaFor({ ...security, class: "news" }, post)).toBeUndefined();
    expect(runtimeMetaFor({ ...security, runtime: null }, post)).toBeUndefined();
    expect(
      runtimeMetaFor(security, { title: "PHP 8.6.0 RC3 available", rawText: "" })
    ).toBeUndefined();
  });

  it("takes an advisory's own facts", () => {
    const meta = {
      kind: "advisory" as const,
      cveIds: ["CVE-1"],
      severity: "high",
      fixedVersions: [],
    };
    expect(
      runtimeMetaFor(
        { ...security, kind: "github_advisories" },
        { title: "x", rawText: "", metadata: meta }
      )
    ).toBe(meta);
  });
});

describe("ruleTriageRows", () => {
  it("files young items as security and leaves history out", () => {
    const now = new Date("2026-10-21T15:00:00Z");
    expect(
      ruleTriageRows(
        [
          { id: "new", publishedAt: new Date("2026-10-21T13:34:25Z"), createdAt: now },
          { id: "old", publishedAt: new Date("2024-06-06T00:00:00Z"), createdAt: now },
          { id: "undated", publishedAt: null, createdAt: now },
        ],
        now
      )
    ).toEqual([
      {
        itemId: "new",
        bucket: "security",
        reason: "runtime-security",
        model: "rule",
        promptVersion: "rule-v1",
      },
      {
        itemId: "undated",
        bucket: "security",
        reason: "runtime-security",
        model: "rule",
        promptVersion: "rule-v1",
      },
    ]);
  });
});

describe("planRuntimeUrgent", () => {
  const repos = new Map([
    ["r1", "garden.example"],
    ["r2", "pixel-studio"],
  ]);
  const rows = [
    {
      repoId: "r1",
      repo: "garden.example",
      name: "php",
      version: "8.3-fpm",
      normalized: "8.3",
      source: "Dockerfile",
      unresolved: false,
    },
    {
      repoId: "r2",
      repo: "pixel-studio",
      name: "php",
      version: "8.4.27",
      normalized: "8.4.27",
      source: ".tool-versions",
      unresolved: false,
    },
  ];
  const pending = (over: Partial<PendingRuntimeMatch>): PendingRuntimeMatch => ({
    matchId: "m",
    repoIds: ["r1", "r2"],
    title: "t",
    url: "https://www.php.net/",
    sourceName: "PHP news",
    runtime: "php",
    metadata: { kind: "announcement", fixedVersions: [] },
    publishedAt: new Date("2026-10-20T20:32:00Z"),
    contentHash: `hash-${over.matchId ?? "m"}`,
    ...over,
  });

  it("sends affected repos with what they run, and skips repos already on the fix", () => {
    const plan = planRuntimeUrgent(
      [
        pending({
          matchId: "ghsa",
          title: "PHP security advisory: RCE via OOM corruption (CVE-2026-109618)",
          metadata: {
            kind: "advisory",
            severity: "critical",
            cveIds: ["CVE-2026-109618"],
            fixedVersions: ["8.2.35", "8.3.36", "8.4.27", "8.5.12"],
          },
          publishedAt: new Date("2026-10-21T13:34:25Z"),
        }),
        pending({
          matchId: "pre",
          title: "Upcoming Critical PHP Security Release",
          metadata: {
            kind: "announcement",
            severity: "critical",
            fixedVersions: [],
            scheduledAt: "2026-10-21T14:00:00.000Z",
          },
        }),
      ],
      repos,
      rows
    );
    expect(plan.send).toEqual(["pre", "ghsa"]);
    expect(plan.items[0].runtime).toMatchObject({
      name: "PHP",
      scheduledFor: "21 Oct 2026, 14:00 UTC",
      repos: [
        { repo: "garden.example", runs: ["php 8.3 (Dockerfile)"] },
        { repo: "pixel-studio", runs: ["php 8.4.27 (.tool-versions)"] },
      ],
    });
    expect(plan.items[1].affectedRepos).toEqual(["garden.example"]);
    // Matched but already on the fix: named, not dropped.
    expect(plan.items[1].runtime?.unaffected).toEqual(["pixel-studio (8.4.27 in .tool-versions)"]);
    expect(plan.items[0].runtime?.unaffected).toBeUndefined();
    expect(plan.items[1].runtime?.action).toBe(
      "garden.example: rebuild to pick up PHP 8.3.36; the php:8.3-fpm tag already points to it"
    );
  });

  it("skips moderate advisories and other release lines, waits on excluded repos", () => {
    const plan = planRuntimeUrgent(
      [
        pending({
          matchId: "medium",
          metadata: { kind: "advisory", severity: "medium", fixedVersions: ["8.3.35"] },
        }),
        pending({
          matchId: "other-line",
          metadata: { kind: "announcement", fixedVersions: ["8.5.12"], lineSpecific: true },
        }),
        pending({ matchId: "excluded", repoIds: ["r9"] }),
      ],
      repos,
      rows
    );
    expect(plan).toEqual({
      items: [],
      send: [],
      covered: { medium: ["r1", "r2"], "other-line": ["r1", "r2"] },
      skip: ["medium", "other-line"],
      wait: ["excluded"],
      fixCarried: [],
    });
  });
});

describe("planRuntimeUrgent follow-ups", () => {
  const repos = new Map([
    ["p", "sigma/pantheon"],
    ["t", "sigma/tracker"],
    ["g", "gone"],
  ]);
  const node = (repoId: string, version: string, normalized: string | null, source: string) => ({
    repoId,
    repo: repos.get(repoId) as string,
    name: "node",
    version,
    normalized,
    source,
    unresolved: false,
    image: "node",
  });
  const rows = [
    node("p", "24.16.0-slim", "24.16.0", "Dockerfile"),
    node("p", "24.x", "24", "package.json engines.node"),
    node("t", "22-bookworm-slim", "22", "Dockerfile"),
  ];

  it("sends an addition after the fix in the fix form, one action per repo", () => {
    const plan = planRuntimeUrgent(
      [
        {
          matchId: "m",
          repoIds: ["p", "t", "g"],
          followUp: { kind: "addition", since: new Date("2026-10-23T03:31:11Z") },
          title: "Wednesday, October 21, 2026 Security Releases",
          url: "https://nodejs.org/en/blog/vulnerability/october-2026-security-releases",
          sourceName: "Node.js vulnerability blog",
          runtime: "node",
          metadata: {
            kind: "announcement",
            severity: "high",
            fixedVersions: ["22.23.4", "24.22.1", "26.12.1"],
            affectedLines: ["26", "24", "22"],
            fixAddedAt: "2026-10-23T11:00:00.000Z",
          },
          publishedAt: new Date("2026-10-21T22:00:00Z"),
          contentHash: "hash-m",
        },
      ],
      repos,
      rows,
      new Date("2026-10-23T15:00:00Z")
    );
    expect(plan.send).toEqual(["m"]);
    const [item] = plan.items;
    expect(item.affectedRepos).toEqual(["sigma/pantheon", "sigma/tracker"]);
    expect(item.runtime?.repoActions).toEqual([
      "sigma/pantheon: move Dockerfile to node:24.22.1-slim",
      "sigma/tracker: rebuild to pick up Node.js 22.23.4; the node:22-bookworm-slim tag already points to it",
    ]);
    expect(item.runtime?.noVersion).toEqual(["gone"]);
    const { subject, text } = renderUrgentEmail("en", plan.items);
    expect(subject).toBe(
      "Briff · urgent · also affects 2 more repos: Wednesday, October 21, 2026 Security Releases"
    );
    expect(text).toContain(
      "Also affects sigma/pantheon, sigma/tracker (added after the alert of 23 Oct 2026, 03:31 UTC). The fixed Node.js releases are out: 22.23.4, 24.22.1, 26.12.1."
    );
    expect(text).toContain("To do: sigma/pantheon: move Dockerfile to node:24.22.1-slim");
    expect(text).toContain("To do: gone: no Node.js version on record; check which version runs");
    expect(text).not.toContain("Fixed in:");
  });
});

describe("runtime urgent email", () => {
  it("states the announcement, what each repo runs, the fix and the action", () => {
    const { subject, text, html } = renderUrgentEmail("en", [
      {
        title: "Upcoming Critical PHP Security Release",
        url: "https://www.php.net/index.php#2026-10-20-1",
        bucket: "security",
        reason: "runtime-security",
        sourceName: "PHP news",
        affectedRepos: ["garden.example"],
        runtime: {
          name: "PHP",
          repos: [{ repo: "garden.example", runs: ["php 8.3 (Dockerfile)"] }],
          fixedVersions: [],
          scheduledFor: "21 Oct 2026, 14:00 UTC",
          severity: "critical",
          cveIds: [],
          action: "Update PHP in garden.example as soon as the fixed release is out.",
        },
      },
    ]);
    expect(subject).toBe("Briff · urgent: Upcoming Critical PHP Security Release");
    expect(text).toContain("PHP announced a security release for 21 Oct 2026, 14:00 UTC.");
    expect(text).toContain("garden.example runs php 8.3 (Dockerfile).");
    expect(text).toContain("To do: Update PHP in garden.example");
    expect(text).toContain("Source: https://www.php.net/index.php#2026-10-20-1");
    expect(html).toContain("garden.example runs php 8.3 (Dockerfile).");
  });
});

describe("selectRuntimeWork", () => {
  const now = new Date("2026-10-23T04:31:00Z");
  const stored = (over: Partial<StoredRuntimeMatch>): StoredRuntimeMatch => ({
    matchId: "m",
    repoIds: ["r1", "r2", "r3"],
    title: "Wednesday, October 21, 2026 Security Releases",
    url: "https://nodejs.org/en/blog/vulnerability/october-2026-security-releases",
    sourceName: "Node.js vulnerability blog",
    runtime: "node",
    metadata: { kind: "announcement", fixedVersions: [], scheduledAt: "2026-10-21" },
    publishedAt: new Date("2026-10-21T22:00:00Z"),
    contentHash: "hash-m",
    createdAt: new Date("2026-10-22T09:00:00Z"),
    urgentAt: null,
    urgentRepoIds: null,
    fixNotifiedAt: null,
    ...over,
  });
  const firstAlert = new Date("2026-10-23T03:31:09.989Z");

  it("sends a pending match of a young item as it is", () => {
    expect(selectRuntimeWork([stored({})], now)).toEqual([
      expect.objectContaining({ matchId: "m", repoIds: ["r1", "r2", "r3"] }),
    ]);
    expect(selectRuntimeWork([stored({})], now)[0].followUp).toBeUndefined();
  });

  it("follows up only for repos the first email did not cover", () => {
    const [work] = selectRuntimeWork(
      [stored({ urgentAt: firstAlert, urgentRepoIds: ["r1"] })],
      now
    );
    expect(work.repoIds).toEqual(["r2", "r3"]);
    expect(work.followUp).toEqual({ kind: "addition", since: firstAlert });
    expect(
      selectRuntimeWork([stored({ urgentAt: firstAlert, urgentRepoIds: ["r1", "r2", "r3"] })], now)
    ).toEqual([]);
    // Handled before the column existed: fully covered.
    expect(selectRuntimeWork([stored({ urgentAt: firstAlert })], now)).toEqual([]);
  });

  it("sends the fix follow-up once, for every repo, while the fix is recent", () => {
    const fixed = {
      kind: "announcement",
      fixedVersions: ["22.23.4", "24.22.1", "26.12.1"],
      fixAddedAt: "2026-10-23T04:00:00.000Z",
    };
    const handled = { urgentAt: firstAlert, urgentRepoIds: ["r1"], metadata: fixed };
    const [work] = selectRuntimeWork([stored(handled)], now);
    expect(work.followUp).toEqual({ kind: "fix" });
    expect(work.repoIds).toEqual(["r1", "r2", "r3"]);
    expect(
      selectRuntimeWork(
        [stored({ ...handled, urgentRepoIds: ["r1", "r2", "r3"], fixNotifiedAt: now })],
        now
      )
    ).toEqual([]);
    // A fix that appears days after an old pre-announcement still reaches a pending match.
    const old = { publishedAt: new Date("2026-10-14T03:00:00Z"), metadata: fixed };
    expect(selectRuntimeWork([stored(old)], now)).toHaveLength(1);
    expect(
      selectRuntimeWork([stored({ ...old, metadata: { ...fixed, fixAddedAt: undefined } })], now)
    ).toEqual([]);
  });
});

describe("runtime urgent follow-up email", () => {
  const runtime = {
    name: "Node.js",
    repos: [{ repo: "orchid-hotel", runs: ["node 22 (Dockerfile)"] }],
    fixedVersions: ["22.23.4", "24.22.1", "26.12.1"],
    scheduledFor: null,
    severity: "high",
    cveIds: [],
    action: "short",
  };
  const base = {
    title: "Wednesday, October 21, 2026 Security Releases",
    url: "https://nodejs.org/en/blog/vulnerability/october-2026-security-releases",
    bucket: "security" as const,
    reason: "runtime-security",
    sourceName: "Node.js vulnerability blog",
  };

  it("marks an addition in the subject and lists only the added repos", () => {
    const { subject, text } = renderUrgentEmail("en", [
      {
        ...base,
        affectedRepos: ["orchid-hotel", "yard"],
        followUp: { kind: "addition", since: "23 Oct 2026, 03:31 UTC" },
        runtime,
      },
    ]);
    expect(subject).toBe(
      "Briff · urgent · also affects 2 more repos: Wednesday, October 21, 2026 Security Releases"
    );
    expect(text).toContain(
      "Also affects orchid-hotel, yard (added after the alert of 23 Oct 2026, 03:31 UTC)."
    );
  });

  it("says the fix is out and gives one action per repo", () => {
    const { subject, text, html } = renderUrgentEmail("en", [
      {
        ...base,
        affectedRepos: ["bakery.example", "grove"],
        followUp: { kind: "fix" },
        runtime: {
          ...runtime,
          repoActions: [
            "bakery.example: node 18 is end-of-life and will not get this fix; move to 22.23.4 or later",
            "grove: rebuild to pick up Node.js 22.23.4; the node:22-alpine tag already points to it",
          ],
        },
      },
    ]);
    expect(subject).toBe(
      "Briff · urgent · fix released: Wednesday, October 21, 2026 Security Releases"
    );
    expect(text).toContain("The fixed Node.js releases are out: 22.23.4, 24.22.1, 26.12.1.");
    expect(text).toContain(
      "To do: bakery.example: node 18 is end-of-life and will not get this fix; move to 22.23.4 or later"
    );
    expect(text).toContain("To do: grove: rebuild to pick up Node.js 22.23.4");
    expect(text).not.toContain("To do: short");
    expect(html).toContain("The fixed Node.js releases are out");
  });
});

describe("runtime urgent email gaps", () => {
  it("lists matched repos that are not affected instead of dropping them", () => {
    const { text, html } = renderUrgentEmail("en", [
      {
        title: "t",
        url: "https://nodejs.org/",
        bucket: "security",
        reason: "runtime-security",
        sourceName: "Node.js vulnerability blog",
        affectedRepos: ["grove"],
        runtime: {
          name: "Node.js",
          repos: [{ repo: "grove", runs: ["node 22 (Dockerfile)"] }],
          fixedVersions: ["22.23.4", "24.22.1"],
          scheduledFor: null,
          severity: "high",
          cveIds: [],
          action: "grove: rebuild",
          unaffected: ["sigma/forms-web (24.22.1 in Dockerfile)"],
        },
      },
    ]);
    expect(text).toContain("Not affected: sigma/forms-web (24.22.1 in Dockerfile).");
    expect(text).toContain("Fixed in: 22.23.4, 24.22.1");
    expect(html).toContain("Not affected: sigma/forms-web");
  });
});

describe("handledMatchUpdate", () => {
  const now = new Date("2026-10-21T14:00:00Z");
  const first = new Date("2026-10-20T21:00:00Z");
  const announcement = { kind: "announcement", fixedVersions: [] };
  const fixed = { kind: "announcement", fixedVersions: ["8.3.36"] };

  it("stamps the first email and keeps fixNotifiedAt for an announcement without a fix", () => {
    expect(
      handledMatchUpdate(
        { urgentAt: null, urgentRepoIds: null, fixNotifiedAt: null, metadata: announcement },
        ["a", "b"],
        "new",
        now
      )
    ).toEqual({ urgentAt: now, urgentRepoIds: ["a", "b"], fixNotifiedAt: undefined });
  });

  it("merges covered repos, keeps the first urgentAt and marks the fix", () => {
    const update = handledMatchUpdate(
      { urgentAt: first, urgentRepoIds: ["a"], fixNotifiedAt: null, metadata: fixed },
      ["b", "a"],
      "fix",
      now
    );
    expect(update).toEqual({ urgentAt: first, urgentRepoIds: ["a", "b"], fixNotifiedAt: now });
  });

  it("marks the fix when the first email already carried fixed versions", () => {
    expect(
      handledMatchUpdate(
        { urgentAt: null, urgentRepoIds: null, fixNotifiedAt: null, metadata: fixed },
        ["a"],
        "new",
        now
      ).fixNotifiedAt
    ).toEqual(now);
  });
});

describe("planRuntimeUrgent incident fold", () => {
  const asOf = new Date("2026-10-21T14:00:00Z");
  const repos = new Map([
    ["g", "garden.example"],
    ["l", "legacy-shop"],
    ["m", "modern"],
  ]);
  const php = (repoId: string, version: string, normalized: string) => ({
    repoId,
    repo: repos.get(repoId) as string,
    name: "php",
    version,
    normalized,
    source: "Dockerfile",
    unresolved: false,
    image: "php",
  });
  const rows = [
    php("g", "8.3-fpm", "8.3"),
    php("l", "8.1.31-apache", "8.1.31"),
    php("m", "8.5.12-fpm", "8.5.12"),
  ];
  const CVES = ["CVE-2026-109618", "CVE-2026-109619"];
  const ALL = ["8.5.12", "8.4.27", "8.3.36", "8.2.35"];
  const match = (
    id: string,
    title: string,
    metadata: Record<string, unknown>,
    publishedAt = "2026-10-21T00:35:26Z"
  ): PendingRuntimeMatch => ({
    matchId: id,
    repoIds: ["g", "l", "m"],
    title,
    url: `https://www.php.net/#${id}`,
    sourceName: "PHP news",
    runtime: "php",
    metadata: { kind: "announcement", severity: "critical", cveIds: CVES, ...metadata },
    publishedAt: new Date(publishedAt),
    contentHash: `hash-${id}`,
  });
  const linePost = (v: string) =>
    match(`php-${v}`, `PHP ${v} Released!`, { fixedVersions: [v], lineSpecific: true });

  it("sends one block per incident with one action per repo and every source", () => {
    const plan = planRuntimeUrgent(
      [
        linePost("8.2.35"),
        linePost("8.3.36"),
        linePost("8.5.12"),
        match("advisory", "Security advisory: Critical remote code execution vulnerabilities", {
          fixedVersions: ALL,
        }),
        match(
          "ghsa",
          "PHP security advisory: RCE via OOM corruption (CVE-2026-109618)",
          {
            kind: "advisory",
            ghsaId: "GHSA-w8hw-w9fx-j79w",
            cveIds: [CVES[0]],
            fixedVersions: ALL,
          },
          "2026-10-21T13:34:25Z"
        ),
      ],
      repos,
      rows,
      asOf
    );
    expect(plan.items).toHaveLength(1);
    const [block] = plan.items;
    expect(block.title).toBe("Security advisory: Critical remote code execution vulnerabilities");
    expect(block.sources?.map((s) => s.label)).toEqual([
      "Security advisory: Critical remote code execution vulnerabilities",
      "PHP 8.3.36 Released!",
      "GHSA-w8hw-w9fx-j79w",
    ]);
    // Posts for a line nobody runs, or one already on the fix, are handled without a word.
    expect(plan.send).toEqual(["advisory", "php-8.3.36", "ghsa"]);
    expect(plan.skip).toEqual(["php-8.2.35", "php-8.5.12"]);
    expect(plan.covered["php-8.5.12"]).toEqual(["g", "l", "m"]);
    expect(block.runtime?.repoActions).toEqual([
      "garden.example: rebuild to pick up PHP 8.3.36; the php:8.3-fpm tag already points to it",
      "legacy-shop: php 8.1 is end-of-life and will not get this fix; move to 8.2.35 or later",
    ]);
    const { text } = renderUrgentEmail("en", plan.items);
    // Truly not affected (already on 8.5.12): said once; the end-of-life line never.
    expect(text.split("Not affected").length).toBe(2);
    expect(text).toContain("Not affected: modern (8.5.12 in Dockerfile).");
    expect(text).not.toMatch(/Not affected:[^\n]*legacy-shop/);
    expect(text).toContain(
      "Sources: Security advisory: Critical remote code execution vulnerabilities <https://www.php.net/#advisory> · PHP 8.3.36 Released! <https://www.php.net/#php-8.3.36> · GHSA-w8hw-w9fx-j79w <https://www.php.net/#ghsa>"
    );
    expect(text).not.toContain("  Source: ");
  });

  it("gives a lone single-line post the end-of-life sentence, never 'Not affected'", () => {
    const plan = planRuntimeUrgent([linePost("8.3.36")], repos, rows, asOf);
    const [block] = plan.items;
    expect(block.sources).toBeUndefined();
    expect(block.runtime?.repoActions).toEqual([
      "garden.example: rebuild to pick up PHP 8.3.36; the php:8.3-fpm tag already points to it",
      "legacy-shop: php 8.1 is end-of-life and will not get this fix; move to 8.2 or later",
    ]);
    // 8.5 is a supported line the post does not list.
    expect(block.runtime?.unaffected).toEqual(["modern (8.5.12 in Dockerfile)"]);
    const future = planRuntimeUrgent(
      [{ ...linePost("8.3.36"), repoIds: ["f"] }],
      new Map([["f", "next"]]),
      [{ ...php("g", "8.6-fpm", "8.6"), repoId: "f", repo: "next" }],
      asOf
    );
    expect(future.items[0].runtime?.repoActions).toEqual([
      "next: check which PHP version runs (Dockerfile: 8.6-fpm); fixed in 8.3.36",
    ]);
    expect(future.items[0].runtime?.unaffected).toBeUndefined();
  });

  it("emails an incident that folds an unknown severity with a low one", () => {
    const plan = planRuntimeUrgent(
      [
        match("unknown", "post", { severity: null, fixedVersions: ALL }),
        match("low", "advisory", {
          kind: "advisory",
          ghsaId: "GHSA-x",
          severity: "low",
          fixedVersions: ALL,
        }),
      ],
      repos,
      rows,
      asOf
    );
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].runtime?.severity).toBeNull();
    expect(plan.send.sort()).toEqual(["low", "unknown"]);
  });

  it("does not send the fix twice when a folded notice later gains the same fixes", () => {
    const notice = match("notice", "Upcoming Critical PHP Security Release", {
      fixedVersions: [],
      scheduledAt: "2026-10-21T14:00:00.000Z",
    });
    const advisory = match("ghsa", "advisory", {
      kind: "advisory",
      ghsaId: "GHSA-x",
      fixedVersions: ALL,
    });
    const plan = planRuntimeUrgent([notice, advisory], repos, rows, asOf);
    expect(plan.items).toHaveLength(1);
    expect(plan.fixCarried.sort()).toEqual(["ghsa", "notice"]);
    const update = handledMatchUpdate(
      { urgentAt: null, urgentRepoIds: null, fixNotifiedAt: null, metadata: notice.metadata },
      plan.covered.notice,
      "new",
      asOf,
      plan.fixCarried.includes("notice")
    );
    expect(update.fixNotifiedAt).toEqual(asOf);
    // The notice is edited in place to name the same fixes: no "fix is out" email again.
    const later = new Date("2026-10-21T16:00:00Z");
    const work = selectRuntimeWork(
      [
        {
          ...notice,
          metadata: {
            ...(notice.metadata as Record<string, unknown>),
            fixedVersions: ALL,
            fixAddedAt: "2026-10-21T15:30:00.000Z",
          },
          createdAt: asOf,
          urgentAt: update.urgentAt,
          urgentRepoIds: update.urgentRepoIds,
          fixNotifiedAt: update.fixNotifiedAt ?? null,
        },
      ],
      later
    );
    expect(work).toEqual([]);
  });

  it("puts the block in the fix form when one folded item is a fix follow-up", () => {
    const plan = planRuntimeUrgent(
      [
        {
          ...match("node-post", "Security Releases", { fixedVersions: ALL }),
          followUp: { kind: "fix" },
        },
        match("ghsa", "advisory", { kind: "advisory", ghsaId: "GHSA-x", fixedVersions: ALL }),
      ],
      repos,
      rows,
      asOf
    );
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].followUp).toEqual({ kind: "fix" });
    expect(plan.send.sort()).toEqual(["ghsa", "node-post"]);
  });
});
