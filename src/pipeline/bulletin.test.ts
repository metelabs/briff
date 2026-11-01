import { upgradeActions } from "./bulletin-by-repo";
import { parseUpgrades } from "./upgrades";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { strings } from "@/lib/i18n";

import {
  ACT_LIMIT,
  actSignals,
  assembleBulletin,
  boundHeadline,
  buildSynthesisInput,
  bulletinSubject,
  countMinor,
  minorRows,
  summaryLine,
  foldKey,
  foldReleases,
  highestFix,
  inScope,
  mergePackageKeys,
  isoWeekLabel,
  KNOW_LIMIT,
  releasePackage,
  selectCandidates,
  subjectTopic,
  subjectTopics,
  SUBJECT_MAX,
  synthesisInputHash,
  synthesisOutputSchema,
  weekStartOf,
  stackForSynthesis,
  storyKeys,
  alertsForSynthesis,
  ALERT_ONLY_LIMIT,
  chooseAction,
  completeRepoNames,
  firstSentence,
  identityTokens,
  itemUpgrades,
  mentionsIdentity,
  namesRepoSubset,
  releaseVersionsOf,
  summariseAlerts,
  type Candidate,
  type PeriodAlert,
  type SelectedCandidate,
  type SynthesisOutput,
} from "./bulletin";
import { fixCommand, type RepoFix } from "./fixes";
import {
  W43_ALERT_FIXES,
  W43_CANDIDATES,
  W43_NOW,
  W43_REPOS,
  w43Output,
} from "./__fixtures__/w43-security";

const candidate = (over: Partial<Candidate>): Candidate => ({
  itemId: "i",
  contentHash: "h",
  title: "Title",
  url: "https://example.com",
  rawText: "body",
  publishedAt: new Date("2026-10-12T00:00:00Z"),
  sourceName: "Next.js blog",
  sourceKind: "rss",
  bucket: "breaking_or_feature",
  score: 0.5,
  matchReason: "service:nextjs",
  repoIds: [],
  keys: { packages: [], services: [], source: "Next.js blog", topic: "breaking_or_feature" },
  dueAt: null,
  dueWhat: null,
  folded: [],
  ...over,
});

const NOW = new Date("2026-10-19T04:00:00Z");
const noAlerts = { now: NOW, alertFixes: new Map<string, RepoFix[]>() };

/** Alert fixes for one package in one repo (installed below the fix). */
const fixFor = (pkg: string, fix: string | null, installed = "15.0.0") =>
  new Map([[pkg, [{ repo: "garden", installed, fix }]]]);

const included = new Map([
  ["r1", "garden"],
  ["r2", "west"],
]);

describe("week helpers", () => {
  it("finds Monday 00:00 UTC and the ISO week", () => {
    expect(weekStartOf(new Date("2026-10-15T13:00:00Z")).toISOString()).toBe(
      "2026-10-12T00:00:00.000Z"
    );
    expect(weekStartOf(new Date("2026-10-12T00:00:00Z")).toISOString()).toBe(
      "2026-10-12T00:00:00.000Z"
    );
    expect(weekStartOf(new Date("2026-10-18T23:59:00Z")).toISOString()).toBe(
      "2026-10-12T00:00:00.000Z"
    );
    expect(isoWeekLabel(new Date("2026-10-15T00:00:00Z"))).toBe("2026-W42");
    expect(isoWeekLabel(new Date("2027-01-01T00:00:00Z"))).toBe("2026-W53");
    expect(isoWeekLabel(new Date("2025-12-29T00:00:00Z"))).toBe("2026-W01");
  });
});

describe("selectCandidates", () => {
  it("drops minor items and items pulled in only by excluded repos", () => {
    const selected = selectCandidates(
      [
        candidate({ itemId: "minor", bucket: "minor" }),
        candidate({ itemId: "excluded", repoIds: ["r9"] }),
        candidate({ itemId: "partly", repoIds: ["r9", "r2", "r1"] }),
        candidate({ itemId: "platform", repoIds: [] }),
      ],
      included,
      {}
    );
    expect(selected.map((s) => [s.itemId, s.affectedRepos])).toEqual([
      ["partly", ["garden", "west"]],
      ["platform", []],
    ]);
  });

  it("ranks by score plus weights, drops strongly down-weighted items except security and deadlines", () => {
    const keys = (pkg: string) => ({
      packages: [pkg],
      services: [],
      source: "S",
      topic: "breaking_or_feature",
    });
    const selected = selectCandidates(
      [
        candidate({ itemId: "low", score: 0.4, keys: keys("expo") }),
        candidate({ itemId: "boosted", score: 0.4, keys: keys("next") }),
        candidate({ itemId: "muted", score: 1, keys: keys("vercel") }),
        candidate({ itemId: "muted-security", score: 1, bucket: "security", keys: keys("vercel") }),
      ],
      included,
      { "package:next": 1, "package:vercel": -4 }
    );
    expect(selected.map((s) => s.itemId)).toEqual(["muted-security", "boosted", "low"]);
  });

  it("caps the input", () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      candidate({ itemId: `i${i}`, score: i / 100 })
    );
    const selected = selectCandidates(many, included, {});
    expect(selected).toHaveLength(30);
    expect(selected[0].itemId).toBe("i79");
  });

  it("keeps must-act candidates beyond the cap", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      candidate({ itemId: `i${i}`, score: 0.5 + i / 100 })
    );
    const sec = candidate({
      itemId: "sec",
      bucket: "security",
      score: 0.01,
      keys: { packages: ["next"], services: [], source: "S", topic: "security" },
    });
    const selected = selectCandidates(
      [...many, sec],
      included,
      {},
      {
        now: NOW,
        alertFixes: fixFor("next", "15.5.28"),
      }
    );
    expect(selected).toHaveLength(31);
    expect(selected[30]).toMatchObject({ itemId: "sec", mustAct: true });
  });

  it("drops pre-releases triaged before the pre-release rule and counts them as minor", () => {
    const items = [
      candidate({ itemId: "canary", title: "vercel/next.js v16.6.0-canary.2" }),
      candidate({ itemId: "stable", title: "vercel/next.js v16.5.0" }),
    ];
    expect(selectCandidates(items, included, {}).map((s) => s.itemId)).toEqual(["stable"]);
    expect(countMinor(items, included)).toBe(1);
  });

  it("counts minor items visible to the included repos", () => {
    expect(
      countMinor(
        [
          candidate({ bucket: "minor" }),
          candidate({ bucket: "minor", repoIds: ["r9"] }),
          candidate({ bucket: "minor", repoIds: ["r1"] }),
        ],
        included
      )
    ).toBe(2);
  });
});

describe("minorRows", () => {
  it("lists the counted minor items newest first with their stream repos and a text line", () => {
    const items = [
      candidate({
        itemId: "old",
        bucket: "minor",
        repoIds: ["r2", "r1", "r9"],
        title: "pkg 1.0.1",
        rawText: "## Patch Changes\n\n- 3f2a9c1: Fix the retry loop",
        publishedAt: new Date("2026-10-13T00:00:00Z"),
      }),
      candidate({ itemId: "outside", bucket: "minor", repoIds: ["r9"] }),
      candidate({ itemId: "major", repoIds: ["r1"] }),
      candidate({
        itemId: "new",
        repoIds: ["r1"],
        title: "vercel/next.js v16.6.0-canary.3",
        rawText: "",
        publishedAt: new Date("2026-10-15T00:00:00Z"),
      }),
    ];
    expect(minorRows(items, included)).toEqual([
      { itemId: "new", line: "", affectedRepos: ["garden"] },
      { itemId: "old", line: "Fix the retry loop", affectedRepos: ["garden", "west"] },
    ]);
    expect(minorRows(items, included).length).toBe(countMinor(items, included));
    expect(minorRows(items, included, undefined, 1).map((r) => r.itemId)).toEqual(["new"]);
  });
});

describe("summaryLine", () => {
  it("takes the first line that says something, as plain text", () => {
    expect(
      summaryLine(
        "# pkg 2.1.3\n\n## What's Changed\n* fix: [handle empty body](https://github.com/o/r/pull/9) by @dev in https://github.com/o/r/pull/9",
        "pkg 2.1.3"
      )
    ).toBe("fix: handle empty body");
    expect(
      summaryLine("<p>Bug fixes</p>\n<p>Faster <code>parse()</code> for large files.</p>")
    ).toBe("Faster parse() for large files.");
    expect(summaryLine("Fixes deadbeef handling in some_module")).toBe(
      "Fixes deadbeef handling in some_module"
    );
    expect(summaryLine("x".repeat(400))).toHaveLength(160);
    expect(summaryLine("\n\n")).toBe("");
  });
});

describe("assembleBulletin", () => {
  const output = synthesisOutputSchema.parse(
    JSON.parse(
      readFileSync(path.join(__dirname, "__fixtures__", "synthesis-response.json"), "utf8")
    )
  );
  const selected = selectCandidates(
    [
      candidate({
        itemId: "deadline",
        bucket: "deadline",
        score: 1,
        title: "Play target API 36",
        dueAt: new Date("2026-10-25T00:00:00Z"),
        dueWhat: "Target API level 36 for app updates",
      }),
      candidate({ itemId: "next", score: 0.9, repoIds: ["r1"] }),
      candidate({ itemId: "expo", score: 0.8 }),
      candidate({ itemId: "beta-notes", score: 0.7 }),
      candidate({ itemId: "skipped", score: 0.1 }),
    ],
    included,
    {},
    noAlerts
  );

  it("keeps only input refs with an action, puts must-act items first, lists the rest", () => {
    const { summary, items } = assembleBulletin(output, selected);
    expect(summary).toBe("Upgrade next in garden; see for details.");
    expect(items.map((i) => [i.itemId, i.section, i.order])).toEqual([
      ["deadline", "act", 0],
      ["next", "act", 1],
      ["beta-notes", "know", 2],
      ["expo", "rest", 3],
      ["skipped", "rest", 4],
    ]);
    expect(items[1]).toMatchObject({
      headline: "Next.js 16.5 middleware fix",
      action: "npm i next@16.5.1",
      todo: null,
      affectedRepos: ["garden"],
    });
    expect(items[0]).toMatchObject({
      headline: "Play target API 36",
      action: "Target API level 36 for app updates",
    });
    expect(items[2]).toMatchObject({ todo: "wait", action: "until the stable SDK ships" });
    expect(items[3]).toMatchObject({ headline: "Title", line: "", action: "", todo: null });
  });

  it("caps act and know at five each and sends the overflow to rest", () => {
    const many = selectCandidates(
      Array.from({ length: 14 }, (_, i) => candidate({ itemId: `i${i}`, score: 1 - i / 100 })),
      included,
      {},
      noAlerts
    );
    const out: SynthesisOutput = {
      summary: "",
      act: many.slice(0, 7).map((_, i) => ({
        ref: i + 1,
        headline: `A${i}`,
        line: "",
        action: "do it",
      })),
      know: many.slice(7, 14).map((_, i) => ({
        ref: i + 8,
        headline: `K${i}`,
        line: "",
        what_to_do: { kind: "read", note: "" },
      })),
    };
    const { items } = assembleBulletin(out, many);
    const count = (section: string) => items.filter((i) => i.section === section).length;
    expect(count("act")).toBe(ACT_LIMIT);
    expect(count("know")).toBe(KNOW_LIMIT);
    expect(count("rest")).toBe(4);
    expect(items.filter((i) => i.section === "rest").map((i) => i.itemId)).toEqual([
      "i5",
      "i6",
      "i12",
      "i13",
    ]);
  });

  it("keeps must-act items inside the act cap", () => {
    const fixes = fixFor("next", "16.5.1", "16.0.0");
    const pool = selectCandidates(
      [
        ...Array.from({ length: 5 }, (_, i) => candidate({ itemId: `f${i}`, score: 0.9 })),
        candidate({
          itemId: "sec",
          bucket: "security",
          score: 0.1,
          keys: { packages: ["next"], services: [], source: "S", topic: "security" },
        }),
      ],
      included,
      {},
      { now: NOW, alertFixes: fixes }
    );
    const out: SynthesisOutput = {
      summary: "",
      act: pool
        .filter((c) => c.itemId !== "sec")
        .map((c) => ({
          ref: pool.indexOf(c) + 1,
          headline: c.itemId,
          line: "",
          action: "x",
        })),
      know: [],
    };
    const act = assembleBulletin(out, pool).items.filter((i) => i.section === "act");
    expect(act).toHaveLength(ACT_LIMIT);
    expect(act[act.length - 1]).toMatchObject({ itemId: "f3" });
    expect(act[0]).toMatchObject({ itemId: "sec", action: "npm i next@16.5.1" });
  });

  it("moves a must-act item the model filed under know into act", () => {
    const pool = selectCandidates(
      [
        candidate({
          itemId: "sec",
          bucket: "security",
          keys: { packages: ["next"], services: [], source: "S", topic: "security" },
        }),
      ],
      included,
      {},
      { now: NOW, alertFixes: fixFor("next", "15.5.28") }
    );
    const { items } = assembleBulletin(
      {
        summary: "",
        act: [],
        know: [{ ref: 1, headline: "H", line: "L", what_to_do: { kind: "read", note: "read it" } }],
      },
      pool
    );
    expect(items).toMatchObject([
      { itemId: "sec", section: "act", headline: "H", action: "npm i next@15.5.28", todo: null },
    ]);
  });

  it("never drops a must-act item without a resolvable fix", () => {
    const pool = selectCandidates(
      [
        candidate({
          itemId: "sec",
          bucket: "security",
          keys: { packages: ["next"], services: [], source: "S", topic: "security" },
        }),
      ],
      included,
      {},
      { now: NOW, alertFixes: fixFor("next", null) }
    );
    expect(pool[0]).toMatchObject({ mustAct: true, suggestedAction: null });
    const fallback = () => "Upgrade next to a fixed version; see the security alert.";
    const left = assembleBulletin({ summary: "", act: [], know: [] }, pool, fallback);
    expect(left.items).toMatchObject([{ section: "act", action: fallback() }]);
    const emptyAction = assembleBulletin(
      { summary: "", act: [{ ref: 1, headline: "H", line: "", action: "" }], know: [] },
      pool,
      fallback
    );
    expect(emptyAction.items).toMatchObject([{ section: "act", action: fallback() }]);
  });

  describe("same-story blog posts", () => {
    const nextKeys = (topic: string) => ({
      packages: ["next"],
      services: ["nextjs"],
      source: "Next.js blog",
      topic,
    });
    const act = candidate({
      itemId: "oob",
      title: "Next.js out-of-band security update released October 14",
      bucket: "security",
      keys: nextKeys("security"),
      repoIds: ["r1"],
    });
    const upcoming = candidate({
      itemId: "upcoming",
      title: "Upcoming Next.js Security Update for Upstream Vulnerabilities",
      bucket: "security",
      // A pre-announcement names no package version, so it is not must-act.
      keys: { ...nextKeys("security"), packages: [] },
      folded: [{ itemId: "older", title: "Older post", url: "https://nextjs.org/blog/older" }],
    });
    const release = candidate({
      itemId: "rel",
      title: "vercel/next.js v16.0.10",
      sourceKind: "github_releases",
      matchReason: "release:next",
      keys: { packages: ["next"], services: [], source: "GitHub", topic: "breaking_or_feature" },
      repoIds: ["r1"],
    });
    const other = candidate({
      itemId: "vercel",
      title: "Vercel Functions now on Fluid compute",
      keys: { packages: [], services: ["vercel"], source: "Vercel", topic: "breaking_or_feature" },
    });
    const out = (refs: number[]): SynthesisOutput => ({
      summary: "",
      act: refs.map((ref) => ({ ref, headline: "H", line: "", action: "npm i next@16.0.10" })),
      know: [],
    });

    it("folds a blog post under the security act item with the same service", () => {
      const pool = selectCandidates(
        [act, upcoming, release, other],
        included,
        {},
        { now: NOW, alertFixes: fixFor("next", "16.0.10", "16.0.3") }
      );
      // The model listed only the out-of-band post; the other three would be "rest".
      const ref = pool.findIndex((c) => c.itemId === "oob") + 1;
      const { items } = assembleBulletin(out([ref]), pool);
      const byId = new Map(items.map((i) => [i.itemId, i]));
      expect(byId.get("oob")).toMatchObject({ section: "act" });
      expect(byId.get("oob")?.foldedItemIds).toEqual(["upcoming", "older"]);
      expect(byId.has("upcoming")).toBe(false);
      // Releases and posts about another service stay in rest.
      expect(byId.get("rel")).toMatchObject({ section: "rest" });
      expect(byId.get("vercel")).toMatchObject({ section: "rest" });
      expect(items.map((i) => i.order)).toEqual(items.map((_, i) => i));
    });

    it("only folds under security act items", () => {
      const deadline = { ...act, bucket: "deadline" as const, keys: nextKeys("deadline") };
      const pool = selectCandidates([deadline, upcoming], included, {}, noAlerts);
      const ref = pool.findIndex((c) => c.itemId === "oob") + 1;
      const { items } = assembleBulletin(out([ref]), pool);
      expect(items.find((i) => i.itemId === "oob")?.foldedItemIds).toEqual([]);
      expect(items.find((i) => i.itemId === "upcoming")).toMatchObject({ section: "rest" });
    });

    it("keys stories by matched runtime", () => {
      expect(
        storyKeys({
          keys: { packages: [], services: [], source: null, topic: null },
          matchReason: "runtime:php",
        })
      ).toEqual(["runtime:php"]);
    });

    it("keys stories by matched service and release or mention package, not triaged names", () => {
      expect(storyKeys(act)).toEqual(["service:nextjs"]);
      expect(storyKeys(release)).toEqual(["package:next"]);
      expect(
        storyKeys({
          keys: { packages: ["zod"], services: [], source: null, topic: null },
          matchReason: "service:vercel+mention:@vercel/og",
        })
      ).toEqual(["package:@vercel/og"]);
    });
  });

  it("carries folded item ids", () => {
    const pool = selectCandidates(
      [
        candidate({
          itemId: "new",
          folded: [{ itemId: "old", title: "v1.0.0", url: "https://x/old" }],
        }),
      ],
      included,
      {},
      noAlerts
    );
    expect(assembleBulletin({ summary: "", act: [], know: [] }, pool).items[0]).toMatchObject({
      section: "rest",
      foldedItemIds: ["old"],
    });
  });

  it("rejects malformed output", () => {
    expect(() => synthesisOutputSchema.parse({ summary: "x", sections: [] })).toThrow();
    expect(() =>
      synthesisOutputSchema.parse({
        summary: "x",
        act: [],
        know: [{ ref: 1, headline: "", line: "", what_to_do: { kind: "maybe", note: "" } }],
      })
    ).toThrow();
  });
});

describe("foldReleases", () => {
  const release = (itemId: string, version: string, over: Partial<Candidate> = {}) =>
    candidate({
      itemId,
      contentHash: `h-${itemId}`,
      title: `vercel/next.js v${version}`,
      url: `https://github.com/vercel/next.js/releases/tag/v${version}`,
      matchReason: "release:next",
      keys: { packages: ["next"], services: [], source: "GitHub", topic: "breaking_or_feature" },
      repoIds: ["r1"],
      ...over,
    });

  it("folds releases of one package into the newest, keeping the most severe bucket", () => {
    const folded = foldReleases([
      release("a", "16.4.1"),
      release("b", "16.5.0", { score: 0.6 }),
      release("c", "16.4.2", { bucket: "security", repoIds: ["r2"], rawText: "Fixes CVE-2026-1" }),
      candidate({ itemId: "blog" }),
    ]);
    expect(folded.map((c) => c.itemId)).toEqual(["b", "blog"]);
    const [b] = folded;
    expect(b).toMatchObject({
      title: "vercel/next.js v16.5.0",
      url: "https://github.com/vercel/next.js/releases/tag/v16.5.0",
      bucket: "security",
      score: 0.6,
      keys: { topic: "security" },
    });
    expect(b.repoIds.sort()).toEqual(["r1", "r2"]);
    expect(b.folded.map((f) => f.itemId)).toEqual(["c", "a"]);
    expect(b.rawText).toContain("Also released in this window: 16.4.2, 16.4.1.");
    expect(b.rawText).toContain("Fixes CVE-2026-1");
    expect(b.contentHash).toContain("h-a");
  });

  it("leaves single releases, other packages, lone minors, pre-releases and mentions alone", () => {
    const input = [
      release("a", "16.4.1"),
      release("m", "16.4.0", { bucket: "minor", matchReason: "release:react" }),
      release("m2", "16.4.3", { bucket: "minor", matchReason: "release:react" }),
      release("p", "16.6.0-canary.3"),
      candidate({ itemId: "x", matchReason: "release:expo", title: "expo 55.0.1" }),
      candidate({
        itemId: "mention",
        matchReason: "mention:next",
        title: "Next.js 16.5",
        keys: { packages: ["next"], services: [], source: "Blog", topic: "breaking_or_feature" },
      }),
    ];
    expect(foldReleases(input)).toEqual(input);
  });

  it("folds versions of a single-product changelog feed by source", () => {
    const cc = (itemId: string, v: string) =>
      candidate({
        itemId,
        title: `Claude Code ${v}`,
        sourceName: "Claude Code",
        sourceKind: "changelog_md",
        matchReason: "trait:always",
      });
    const folded = foldReleases([cc("a", "2.1.284"), cc("b", "2.1.286"), cc("c", "2.1.280")]);
    expect(folded.map((c) => [c.title, c.folded.map((f) => f.itemId)])).toEqual([
      ["Claude Code 2.1.286", ["a", "c"]],
    ]);
    expect(
      foldKey({
        matchReason: "trait:ios",
        sourceKind: "rss",
        sourceName: "Apple",
        title: "iOS 26.1",
      })
    ).toBeNull();
  });

  it("hashes the folded group independently of query order", () => {
    const a = [release("a", "16.4.1"), release("b", "16.5.0"), release("c", "16.4.2")];
    const forward = foldReleases(a)[0];
    const reversed = foldReleases([...a].reverse())[0];
    expect(forward.contentHash).toBe("h-a,h-b,h-c");
    expect(reversed.contentHash).toBe(forward.contentHash);
    const sel = (cands: Candidate[]) => selectCandidates(cands, included, {}, noAlerts);
    const input = (cands: Candidate[]) =>
      buildSynthesisInput({
        language: "tr",
        week: "2026-W43",
        profileText: "",
        weights: {},
        stack: [],
        selected: sel(cands),
        minorCount: 0,
        alerts: [],
      });
    expect(synthesisInputHash("m", "v", input([forward]), sel([forward]))).toBe(
      synthesisInputHash("m", "v", input([reversed]), sel([reversed]))
    );
  });

  it("never folds or lists monorepo commit-sha tag releases, whatever triage said", () => {
    const baml = (itemId: string, sha: string, title: string) =>
      candidate({
        itemId,
        title: `baml-language-source-${sha}: ${title}`,
        url: `https://github.com/BoundaryML/baml/releases/tag/baml-language-source-${sha}`,
        sourceName: "BoundaryML/baml",
        sourceKind: "github_releases",
        matchReason: "release:@boundaryml/baml",
        keys: {
          packages: ["@boundaryml/baml"],
          services: [],
          source: "GitHub",
          topic: "breaking_or_feature",
        },
        repoIds: ["r1"],
      });
    const input = [
      baml("a", "481d074234fce9df31ee0ab0da5f29c5d5fe1e4d", "Deliver owned spans to BCS (#5310)"),
      baml("b", "0f3c2a9e8d7b6c5a4f3e2d1c0b9a8f7e6d5c4b3a", "Fix span ids (#5311)"),
      baml("c", "1234567890abcdef1234567890abcdef12345678", "Bump deps (#5312)"),
      release("n", "16.4.1"),
    ];
    expect(foldReleases(input)).toEqual(input);
    const selected = selectCandidates(foldReleases(input), included, {}, noAlerts);
    expect(selected.map((c) => c.itemId)).toEqual(["n"]);
    expect(countMinor(input, included)).toBe(3);
  });

  it("reads the package from the match reason", () => {
    expect(releasePackage({ matchReason: "release:@sentry/react+mention:sentry" })).toBe(
      "@sentry/react"
    );
    expect(releasePackage({ matchReason: "trait:ios" })).toBeNull();
  });
});

describe("foldReleases across ecosystems", () => {
  it("never folds an npm and a PyPI release of one name together", () => {
    const npm = candidate({
      itemId: "n",
      title: "redis 5.8.0",
      sourceKind: "github_releases",
      matchReason: "release:redis",
      matchedPackage: { ecosystem: "npm", name: "redis" },
    });
    const py = candidate({
      itemId: "p",
      title: "redis 5.2.1",
      sourceKind: "github_releases",
      matchReason: "release:redis",
      matchedPackage: { ecosystem: "PyPI", name: "redis" },
    });
    expect(foldKey(npm)).toBe("package:redis");
    expect(foldKey(py)).toBe("package:PyPI:redis");
    expect(
      foldReleases([npm, py])
        .map((c) => c.itemId)
        .sort()
    ).toEqual(["n", "p"]);
  });
});

describe("highestFix", () => {
  it("picks one install target that fixes every alert, or none", () => {
    expect(highestFix(["15.2.6", "15.5.28", "15.1.9"])).toBe("15.5.28");
    expect(highestFix(["15.5.28"])).toBe("15.5.28");
    expect(highestFix(["15.5.28", null])).toBeNull();
    expect(highestFix([])).toBeNull();
    // The advisory-wide list is not a version; it must never become a command.
    expect(highestFix(["15.0.5, 15.1.9, 15.2.6"])).toBeNull();
  });
});

describe("actSignals", () => {
  const sec = candidate({
    bucket: "security",
    keys: { packages: ["next"], services: [], source: "S", topic: "security" },
  });

  it("marks security items whose package has an alert, with the fix command", () => {
    expect(actSignals(sec, { now: NOW, alertFixes: fixFor("next", "15.5.28") })).toEqual({
      mustAct: true,
      suggestedAction: "npm i next@15.5.28",
      fixVersions: ["15.5.28"],
    });
    expect(actSignals(sec, { now: NOW, alertFixes: fixFor("next", null) })).toEqual({
      mustAct: true,
      suggestedAction: null,
      fixVersions: [],
    });
    expect(actSignals(sec, noAlerts).mustAct).toBe(false);
  });

  it("derives the command and the transitive advice in the package's ecosystem", () => {
    const composerSec = candidate({
      bucket: "security",
      keys: { packages: ["acme/log"], services: [], source: "S", topic: "security" },
    });
    const fixes = (direct: boolean) =>
      new Map([
        [
          "acme/log",
          [
            {
              repo: "acme/shop",
              installed: "3.0.2",
              fix: "3.0.3",
              direct,
              ecosystem: "Packagist" as const,
            },
          ],
        ],
      ]);
    expect(actSignals(composerSec, { now: NOW, alertFixes: fixes(true) }).suggestedAction).toBe(
      "composer require acme/log:^3.0.3"
    );
    expect(
      actSignals(composerSec, {
        now: NOW,
        alertFixes: fixes(false),
        transitiveAction: strings("en").act_transitive,
      }).suggestedAction
    ).toBe(
      "acme/log is a transitive dependency: update the packages that pull it in (composer why acme/log shows which)."
    );
  });

  it("keeps an npm and a PyPI package of one name apart in the derived action", () => {
    const fixes = new Map([
      [
        "redis",
        [
          { repo: "acme/web", installed: "4.6.0", fix: "4.6.1", direct: true },
          {
            repo: "acme/jobs",
            installed: "5.0.0",
            fix: "5.0.2",
            direct: true,
            ecosystem: "PyPI" as const,
            manager: "uv" as const,
          },
        ],
      ],
    ]);
    const item = (ecosystem: string | null) =>
      candidate({
        bucket: "security",
        keys: { packages: ["redis"], services: [], source: "S", topic: "security" },
        matchedPackage: ecosystem ? { ecosystem, name: "redis" } : null,
      });
    expect(actSignals(item("PyPI"), { now: NOW, alertFixes: fixes }).suggestedAction).toBe(
      "uv add redis==5.0.2"
    );
    expect(actSignals(item("npm"), { now: NOW, alertFixes: fixes }).suggestedAction).toBe(
      "npm i redis@4.6.1"
    );
    // Only the npm package has alerts: a PyPI item gets none of them.
    const npmOnly = new Map([["redis", [fixes.get("redis")![0]]]]);
    expect(actSignals(item("PyPI"), { now: NOW, alertFixes: npmOnly }).suggestedAction).toBeNull();
    // Named without a match to either package: no command that could mix them.
    expect(actSignals(item(null), { now: NOW, alertFixes: fixes })).toMatchObject({
      mustAct: true,
      suggestedAction: null,
    });
  });

  it("makes a service-matched security item must-act through the packages triage named", () => {
    const viaService = candidate({
      bucket: "security",
      matchReason: "service:nextjs",
      keys: {
        packages: mergePackageKeys(null, ["next", " next ", ""]),
        services: ["nextjs"],
        source: "Next.js blog",
        topic: "security",
      },
    });
    expect(viaService.keys.packages).toEqual(["next"]);
    expect(actSignals(viaService, { now: NOW, alertFixes: fixFor("next", "15.5.28") })).toEqual({
      mustAct: true,
      suggestedAction: "npm i next@15.5.28",
      fixVersions: ["15.5.28"],
    });
    expect(mergePackageKeys("next", ["next", "@next/env"])).toEqual(["next", "@next/env"]);
  });

  it("suggests the release the item is about when it covers the OSV fix", () => {
    const release = candidate({
      bucket: "security",
      title: "fastify v5.12.6",
      sourceKind: "github_releases",
      matchReason: "release:fastify",
      keys: { packages: ["fastify"], services: [], source: "fastify", topic: "security" },
    });
    expect(
      actSignals(release, { now: NOW, alertFixes: fixFor("fastify", "5.12.5", "5.8.5") })
    ).toEqual({ mustAct: true, suggestedAction: "npm i fastify@5.12.6", fixVersions: ["5.12.6"] });
  });

  it("falls back to the sentence when the only fix is on a higher major line", () => {
    const release = candidate({
      bucket: "security",
      title: "fastify v6.0.1",
      sourceKind: "github_releases",
      matchReason: "release:fastify",
      keys: { packages: ["fastify"], services: [], source: "fastify", topic: "security" },
    });
    const ctx = { now: NOW, alertFixes: fixFor("fastify", "6.0.0", "5.8.5") };
    expect(actSignals(release, ctx)).toEqual({
      mustAct: true,
      suggestedAction: null,
      fixVersions: [],
    });
    const pool = selectCandidates([release], included, {}, ctx);
    const fallback = () => "Upgrade fastify to a fixed version; see the security alert.";
    expect(
      assembleBulletin({ summary: "", act: [], know: [] }, pool, fallback).items
    ).toMatchObject([{ section: "act", action: fallback() }]);
  });

  it("treats only close deadlines as act-now", () => {
    const due = (iso: string) =>
      candidate({ bucket: "deadline", dueAt: new Date(iso), dueWhat: "Do X" });
    expect(actSignals(due("2026-10-30T00:00:00Z"), noAlerts)).toEqual({
      mustAct: true,
      suggestedAction: "Do X",
    });
    expect(actSignals(due("2027-03-01T00:00:00Z"), noAlerts).mustAct).toBe(false);
  });
});

describe("synthesis input and hash", () => {
  const args = {
    language: "tr",
    week: "2026-W42",
    profileText: "",
    weights: {},
    stack: [
      {
        name: "garden",
        dependencies: [{ name: "next", version: "15.4.7" }],
        services: ["Next.js"],
      },
    ],
    selected: selectCandidates(
      [candidate({ itemId: "a", rawText: "x".repeat(3000) })],
      included,
      {}
    ),
    minorCount: 3,
    alerts: [],
  };

  it("trims item text and numbers refs", () => {
    const input = buildSynthesisInput(args);
    expect(input.items[0]).toMatchObject({
      ref: 1,
      bucket: "breaking_or_feature",
      published: "2026-10-12",
    });
    expect(input.items[0].text).toHaveLength(700);
  });

  it("writes an unresolved requirement as one, never as an installed version", () => {
    const input = buildSynthesisInput({
      ...args,
      stack: [
        {
          name: "garden",
          dependencies: [
            { name: "next", version: "15.4.7" },
            { name: "acme-orm", version: "~=2.0", ecosystem: "PyPI", unresolved: true },
          ],
          services: [],
        },
      ],
      selected: selectCandidates(
        [
          candidate({
            itemId: "o",
            keys: { packages: ["acme-orm", "next"], services: [], source: "S", topic: "x" },
          }),
        ],
        included,
        {}
      ),
    });
    expect(input.stack[0].packages).toEqual(["next@15.4.7", "acme-orm (requires ~=2.0)"]);
  });

  it("keeps longer text for security and deadline items", () => {
    const selected = selectCandidates(
      [candidate({ itemId: "s", bucket: "security", rawText: "x".repeat(3000) })],
      included,
      {}
    );
    expect(buildSynthesisInput({ ...args, selected }).items[0].text).toHaveLength(1200);
  });

  it("adds a repo's runtimes only when a selected item matched on that runtime", () => {
    const stack = [
      {
        name: "garden",
        dependencies: [],
        services: [],
        runtimes: [
          { name: "php", version: "8.3" },
          { name: "php", version: "8.3" },
          { name: "node", version: "22" },
        ],
      },
      {
        name: "west",
        dependencies: [],
        services: [],
        runtimes: [{ name: "node", version: "22" }],
      },
    ];
    const php = candidate({ itemId: "p", matchReason: "runtime:php", repoIds: ["garden"] });
    expect(stackForSynthesis(stack, [php])).toEqual([
      { name: "garden", packages: [], services: [], runtimes: ["php 8.3"] },
      { name: "west", packages: [], services: [] },
    ]);
    // No runtime item: no runtimes key at all, so existing input hashes do not move.
    expect(stackForSynthesis(stack, [candidate({})])[0]).not.toHaveProperty("runtimes");
  });

  it("passes only the packages the selected items reference, with versions and services", () => {
    const stack = [
      {
        name: "garden",
        dependencies: [
          { name: "next", version: "15.4.7" },
          { name: "react", version: "19.3.0" },
          { name: "zod", version: "4.1.0" },
        ],
        services: ["Next.js"],
      },
      { name: "west", dependencies: [{ name: "expo", version: "54.0.0" }], services: ["Expo"] },
    ];
    const selected = selectCandidates(
      [
        candidate({
          itemId: "n",
          keys: {
            packages: ["next"],
            services: ["nextjs"],
            source: "S",
            topic: "breaking_or_feature",
          },
        }),
        candidate({
          itemId: "z",
          keys: {
            packages: ["zod", "left-pad"],
            services: [],
            source: "S",
            topic: "breaking_or_feature",
          },
        }),
      ],
      included,
      {}
    );
    const expected = [
      { name: "garden", packages: ["next@15.4.7", "zod@4.1.0"], services: ["Next.js"] },
      { name: "west", packages: [], services: ["Expo"] },
    ];
    expect(stackForSynthesis(stack, selected)).toEqual(expected);
    expect(buildSynthesisInput({ ...args, stack, selected }).stack).toEqual(expected);
    const alert = (pkg: string) => ({
      package: pkg,
      severity: "HIGH",
      osvId: `GHSA-${pkg}`,
      repos: ["garden"],
      fixed: null,
    });
    const input = buildSynthesisInput({
      ...args,
      selected,
      alerts: [alert("next"), alert("lodash"), alert("zod")],
    });
    expect(input.security_alerts.map((a) => a.package)).toEqual(["next", "zod"]);
  });

  it("keeps the most severe alerts, grouped per package, when no item was selected", () => {
    const alert = (pkg: string, n: number, severity: string) => ({
      package: pkg,
      severity,
      osvId: `GHSA-${pkg}-${String(n).padStart(2, "0")}`,
      repos: ["garden"],
      fixed: null,
    });
    const alerts = [
      ...Array.from({ length: 25 }, (_, i) => alert("lodash", i, "LOW")),
      alert("undici", 1, "HIGH"),
      alert("next", 1, "CRITICAL"),
      alert("undici", 2, "MODERATE"),
    ];
    const kept = alertsForSynthesis(alerts, []);
    expect(kept).toHaveLength(ALERT_ONLY_LIMIT);
    expect(kept.slice(0, 4).map((a) => a.osvId)).toEqual([
      "GHSA-next-01",
      "GHSA-undici-01",
      "GHSA-undici-02",
      "GHSA-lodash-00",
    ]);
    const input = buildSynthesisInput({ ...args, selected: [], alerts });
    expect(input.items).toEqual([]);
    expect(input.security_alerts).toHaveLength(ALERT_ONLY_LIMIT);
  });

  it("is stable for the same input and changes with content, model or prompt", () => {
    const input = buildSynthesisInput(args);
    const h = synthesisInputHash("m", "v1", input, args.selected);
    expect(synthesisInputHash("m", "v1", buildSynthesisInput(args), args.selected)).toBe(h);
    expect(synthesisInputHash("m2", "v1", input, args.selected)).not.toBe(h);
    expect(synthesisInputHash("m", "v2", input, args.selected)).not.toBe(h);
    const changed = args.selected.map((s) => ({ ...s, contentHash: "other" }));
    expect(synthesisInputHash("m", "v1", input, changed)).not.toBe(h);
  });

  it("is keyed per stream: the same input in two streams never shares a hash", () => {
    const input = buildSynthesisInput(args);
    const work = synthesisInputHash("m", "v1", input, args.selected, "stream-work");
    expect(synthesisInputHash("m", "v1", input, args.selected, "stream-work")).toBe(work);
    expect(synthesisInputHash("m", "v1", input, args.selected, "stream-personal")).not.toBe(work);
    expect(synthesisInputHash("m", "v1", input, args.selected)).not.toBe(work);
  });
});

describe("bulletinSubject", () => {
  it("names at most two act topics, then says there is more", () => {
    expect(bulletinSubject("Work", "2026-W43", ["undici", "nodemailer", "next"])).toBe(
      "Briff · Work · W43: undici · nodemailer and more"
    );
    expect(bulletinSubject("Work", "2026-W43", ["undici", "nodemailer"])).toBe(
      "Briff · Work · W43: undici · nodemailer"
    );
    expect(bulletinSubject("Personal", "2026-W43", ["undici"])).toBe(
      "Briff · Personal · W43: undici"
    );
  });

  it("deduplicates topics and says when nothing is urgent", () => {
    expect(bulletinSubject("Work", "2026-W43", ["next", "Next", "next"])).toBe(
      "Briff · Work · W43: next"
    );
    expect(bulletinSubject("Work", "2026-W43", [])).toBe(
      "Briff · Work · W43: nothing urgent this week"
    );
  });

  it("stays within 78 characters", () => {
    const long = "@react-native-community/datetimepicker-with-a-very-long-name";
    const one = bulletinSubject("Work", "2026-W43", [long, "@sentry/react-native", "x"]);
    expect(one.length).toBeLessThanOrEqual(SUBJECT_MAX);
    expect(one).toMatch(/^Briff · Work · W43: @react-native.*… and more$/);
    const dropped = bulletinSubject("Work", "2026-W43", [
      "@sentry/react-native",
      "@react-native-firebase/app-check",
      "z",
    ]);
    expect(dropped).toBe("Briff · Work · W43: @sentry/react-native and more");
  });
});

describe("subjectTopics", () => {
  it("reads the topics back, also when the stream name contains ': '", () => {
    const subject = bulletinSubject("Team: Infra", "2026-W43", ["undici", "nodemailer"]);
    expect(subject).toBe("Briff · Team: Infra · W43: undici · nodemailer");
    expect(subjectTopics(subject, "Team: Infra")).toBe("undici · nodemailer");
    // Stream deleted (name unknown): the week marker still ends the prefix.
    expect(subjectTopics(subject, null)).toBe("undici · nodemailer");
    expect(subjectTopics("Briff · Work · W43: nothing urgent this week", "Work")).toBe(
      "nothing urgent this week"
    );
    expect(subjectTopics("Briff · 2026-W42: a · b", null)).toBe("a · b");
    expect(subjectTopics("Briff · 2026-W42", null)).toBe("Briff · 2026-W42");
  });
});

describe("subjectTopic", () => {
  it("prefers the released package, then the matched package, the service, the headline", () => {
    expect(
      subjectTopic(
        candidate({
          matchReason: "release:undici",
          keys: { ...candidate({}).keys, packages: ["x"] },
        }),
        "H"
      )
    ).toBe("undici");
    expect(
      subjectTopic(
        candidate({
          matchReason: "mention:nodemailer",
          keys: { ...candidate({}).keys, packages: ["nodemailer"] },
        }),
        "H"
      )
    ).toBe("nodemailer");
    expect(
      subjectTopic(
        candidate({
          matchReason: "service:sentry",
          keys: { ...candidate({}).keys, services: ["sentry"] },
        }),
        "H"
      )
    ).toBe("Sentry");
    expect(
      subjectTopic(
        candidate({ matchReason: "trait:always" }),
        "Claude Code adds hooks, plugins and more"
      )
    ).toBe("Claude Code adds");
  });
});

describe("stream scope", () => {
  const work = new Map([["r1", "garden"]]);

  it("keeps an item only when one of its repos is in the stream", () => {
    const selected = selectCandidates(
      [
        candidate({ itemId: "outside", repoIds: ["r2"] }),
        candidate({ itemId: "shared", repoIds: ["r2", "r1"] }),
        candidate({ itemId: "inside", repoIds: ["r1"] }),
      ],
      work,
      {}
    );
    expect(selected.map((c) => c.itemId).sort()).toEqual(["inside", "shared"]);
    expect(selected.find((c) => c.itemId === "shared")?.affectedRepos).toEqual(["garden"]);
  });

  it("keeps platform-wide items only for streams with the trait; always feeds go everywhere", () => {
    const traits = new Set(["web", "nextjs"]);
    const items = [
      candidate({ itemId: "ios", matchReason: "trait:ios" }),
      candidate({ itemId: "next", matchReason: "trait:nextjs" }),
      candidate({ itemId: "claude", matchReason: "trait:always" }),
    ];
    const selected = selectCandidates(items, work, {}, { ...noAlerts, traits });
    expect(selected.map((c) => c.itemId).sort()).toEqual(["claude", "next"]);
    // Without stream traits (no scope given) every platform item stays, as before streams.
    expect(selectCandidates(items, work, {})).toHaveLength(3);
    expect(inScope({ repoIds: [], matchReason: "trait:ios" }, work, new Set())).toBe(false);
  });

  it("counts minor items with the same scope", () => {
    const minor = [
      candidate({ itemId: "m1", bucket: "minor", repoIds: ["r2"] }),
      candidate({ itemId: "m2", bucket: "minor", repoIds: ["r1"] }),
      candidate({ itemId: "m3", bucket: "minor", matchReason: "trait:ios" }),
    ];
    expect(countMinor(minor, work, new Set(["web"]))).toBe(1);
  });
});

describe("transitive security items", () => {
  const sec = candidate({
    bucket: "security",
    matchReason: "release:undici",
    sourceKind: "github_releases",
    title: "nodejs/undici v7.30.1",
    keys: { packages: ["undici"], services: [], source: "S", topic: "security" },
  });
  const transitiveAction = (pkg: string) => `${pkg} is transitive`;

  it("gives a transitive-only package the transitive action instead of an install command", () => {
    const alertFixes = new Map([
      [
        "undici",
        [
          { repo: "briff", installed: "7.29.0", fix: "7.29.1", direct: false },
          { repo: "mint-app", installed: "7.28.0", fix: "7.29.1", direct: false },
        ],
      ],
    ]);
    expect(actSignals(sec, { now: NOW, alertFixes, transitiveAction })).toEqual({
      mustAct: true,
      suggestedAction: "undici is transitive",
      fixVersions: ["7.30.1"],
    });
  });

  it("keeps the command for direct repos and names the transitive ones after it", () => {
    const alertFixes = new Map([
      [
        "undici",
        [
          { repo: "tracker", installed: "7.29.0", fix: "7.29.1", direct: true },
          { repo: "briff", installed: "7.28.0", fix: "7.29.1", direct: false },
        ],
      ],
    ]);
    expect(actSignals(sec, { now: NOW, alertFixes, transitiveAction }).suggestedAction).toBe(
      "npm i undici@7.30.1 (tracker) · transitive: briff"
    );
  });
});

describe("summariseAlerts", () => {
  const range = (introduced: string, fixed: string) => ({
    type: "SEMVER",
    events: [{ introduced }, { fixed }],
  });
  const alert = (over: Partial<PeriodAlert>): PeriodAlert => ({
    kind: "new",
    repo: "garden",
    osvId: "GHSA-1",
    severity: "HIGH",
    affected: [range("7.0.0", "7.29.1")],
    packageName: "undici",
    installed: [{ version: "7.20.0", direct: true }],
    ...over,
  });

  it("keeps backlog alerts out of the synthesis summaries but in the repo fixes", () => {
    const { summaries, repoFixes } = summariseAlerts([
      alert({}),
      alert({ kind: "backlog", osvId: "GHSA-old", repo: "briff" }),
    ]);
    expect(summaries.map((s) => s.osvId)).toEqual(["GHSA-1"]);
    expect(summaries[0].fixed).toBe("7.29.1");
    expect(repoFixes.get("undici")?.map((f) => f.repo)).toEqual(["garden", "briff"]);
  });

  it("uses only affected installed versions, so a repo already past the fix keeps the command", () => {
    // briff installs undici twice; only 7.20.0 is affected. A repo upgraded past the fix
    // used to add a null fix, which made recommendFixes give up on the whole command.
    const { repoFixes } = summariseAlerts([
      alert({
        repo: "briff",
        installed: [
          { version: "7.30.0", direct: false },
          { version: "7.20.0", direct: true },
        ],
      }),
      alert({ repo: "budget", installed: [{ version: "7.30.0", direct: true }] }),
    ]);
    expect(repoFixes.get("undici")).toEqual([
      { repo: "briff", installed: "7.20.0", fix: "7.29.1", direct: true },
    ]);
    expect(fixCommand("undici", null, repoFixes.get("undici") ?? [])).toBe("npm i undici@7.29.1");
  });

  it("keeps an empty entry for a package without installed versions on record", () => {
    const { repoFixes } = summariseAlerts([alert({ installed: [] })]);
    expect(repoFixes.get("undici")).toEqual([]);
  });

  it("treats every installed version as affected when the advisory has no SEMVER range", () => {
    const { repoFixes } = summariseAlerts([alert({ affected: [] })]);
    expect(repoFixes.get("undici")).toEqual([
      { repo: "garden", installed: "7.20.0", fix: null, direct: true },
    ]);
  });
});

describe("action coverage (synthesis-v5)", () => {
  const repos = [
    "clinic.example",
    "garden.example",
    "sigma/pantheon",
    "sigma/tracker",
    "west.garden.example",
  ];

  it("detects a sentence that names only some affected repos", () => {
    expect(namesRepoSubset("Upgrade express in garden.example, pantheon and tracker", repos)).toBe(
      true
    );
    expect(namesRepoSubset("Upgrade express in every affected repo", repos)).toBe(false);
    expect(
      namesRepoSubset(
        "Upgrade express in clinic.example, garden.example, pantheon, tracker and west.garden.example",
        repos
      )
    ).toBe(false);
    // west.garden.example does not count as naming garden.example.
    expect(
      namesRepoSubset("Upgrade in west.garden.example", ["garden.example", "west.garden.example"])
    ).toBe(true);
    expect(namesRepoSubset("Upgrade in garden.example.", ["garden.example"])).toBe(false);
  });

  const express = (over: Partial<SelectedCandidate>): SelectedCandidate => ({
    ...candidate({ itemId: "express", bucket: "breaking_or_feature" }),
    rank: 1,
    affectedRepos: repos,
    mustAct: false,
    suggestedAction: null,
    ...over,
  });
  const fallback = () => "fallback";

  it("lets the derived command win for a security must-act item", () => {
    const c = express({
      bucket: "security",
      mustAct: true,
      suggestedAction: "npm i express@5.2.1",
    });
    expect(chooseAction("Update express to 5.2.1 in garden.example", c, fallback)).toBe(
      "npm i express@5.2.1"
    );
    expect(chooseAction("Update express in every affected repo", c, fallback)).toBe(
      "npm i express@5.2.1"
    );
  });

  it("replaces a model command with the derived command", () => {
    const c = express({ suggestedAction: "npm i express@5.2.1" });
    expect(chooseAction("npm i express@6.0.0", c, fallback)).toBe("npm i express@5.2.1");
  });

  it("falls back from a repo subset to the derived action, else the must-act fallback", () => {
    const subset = "Upgrade express in garden.example, pantheon and tracker";
    expect(chooseAction(subset, express({ suggestedAction: "Raise the limit" }), fallback)).toBe(
      "Raise the limit"
    );
    expect(chooseAction(subset, express({ mustAct: true }), fallback)).toBe("fallback");
    // Nothing better is known for an optional item: the sentence stays.
    expect(chooseAction(subset, express({}), fallback)).toBe(subset);
    expect(chooseAction("Upgrade express everywhere", express({}), fallback)).toBe(
      "Upgrade express everywhere"
    );
  });

  it("applies the rule in assembleBulletin", () => {
    const c = express({ bucket: "deadline", mustAct: true, suggestedAction: "Move to Express 5" });
    const out = assembleBulletin(
      {
        summary: "",
        act: [{ ref: 1, headline: "h", line: "l", action: "Upgrade express in pantheon" }],
        know: [],
      },
      [c]
    );
    expect(out.items[0].action).toBe("Move to Express 5");
  });
});

const nodemailer = (itemId: string, version: string, over: Partial<Candidate> = {}) =>
  candidate({
    itemId,
    contentHash: `h-${itemId}`,
    title: `nodemailer/nodemailer v${version}`,
    url: `https://github.com/nodemailer/nodemailer/releases/tag/v${version}`,
    sourceName: "nodemailer/nodemailer releases",
    sourceKind: "github_releases",
    matchReason: "release:nodemailer",
    bucket: "minor",
    keys: { packages: ["nodemailer"], services: [], source: "GitHub", topic: "minor" },
    repoIds: ["r1"],
    ...over,
  });

describe("foldReleases with minor releases", () => {
  const window = () => [
    nodemailer("n2", "10.1.2", {
      bucket: "security",
      rawText: "Bounds message work and token requests.",
      publishedAt: new Date("2026-10-16T00:00:00Z"),
    }),
    ...["10.1.5", "10.1.3", "10.1.7", "10.1.4", "10.1.6"].map((v) =>
      nodemailer(`n${v.split(".")[2]}`, v, { publishedAt: new Date("2026-10-18T00:00:00Z") })
    ),
  ];

  it("folds newer minor releases under the security release and installs the newest", () => {
    const folded = foldReleases(window());
    expect(folded).toHaveLength(1);
    const [item] = folded;
    expect(item).toMatchObject({
      itemId: "n2",
      title: "nodemailer/nodemailer v10.1.2",
      bucket: "security",
    });
    expect(item.folded.map((f) => f.title)).toEqual([
      "nodemailer/nodemailer v10.1.7",
      "nodemailer/nodemailer v10.1.6",
      "nodemailer/nodemailer v10.1.5",
      "nodemailer/nodemailer v10.1.4",
      "nodemailer/nodemailer v10.1.3",
    ]);
    expect(item.rawText).toContain("Also released in this window: 10.1.7, 10.1.6, 10.1.5");
    expect(countMinor(folded, included)).toBe(0);

    const alertFixes = new Map([
      ["nodemailer", [{ repo: "garden", installed: "10.1.0", fix: "10.1.2" }]],
    ]);
    expect(actSignals(item, { now: NOW, alertFixes })).toEqual({
      mustAct: true,
      suggestedAction: "npm i nodemailer@10.1.7",
      fixVersions: ["10.1.7"],
    });
    const [selected] = selectCandidates(folded, included, {}, { now: NOW, alertFixes });
    expect(
      buildSynthesisInput({
        language: "en",
        week: "2026-W43",
        profileText: "",
        weights: {},
        stack: [],
        selected: [selected],
        minorCount: 0,
        alerts: [],
      }).items[0]
    ).toMatchObject({ suggested_action: "npm i nodemailer@10.1.7" });
  });

  it("lists a minor release on another major without letting it drive the command", () => {
    const folded = foldReleases([...window(), nodemailer("n11", "11.0.0")]);
    expect(folded).toHaveLength(1);
    expect(folded[0].folded[0].title).toBe("nodemailer/nodemailer v11.0.0");
    expect(releaseVersionsOf(folded[0], "nodemailer")).toContain("11.0.0");
    const alertFixes = new Map([
      ["nodemailer", [{ repo: "garden", installed: "10.1.0", fix: "10.1.2" }]],
    ]);
    expect(actSignals(folded[0], { now: NOW, alertFixes }).suggestedAction).toBe(
      "npm i nodemailer@10.1.7"
    );
  });

  it("is independent of query order and keeps rule-minor rows out", () => {
    const input = [...window(), nodemailer("pre", "10.2.0-beta.1")];
    const forward = foldReleases(input);
    const reversed = foldReleases([...input].reverse());
    const byId = (cs: Candidate[]) => [...cs].sort((a, b) => a.itemId.localeCompare(b.itemId));
    expect(byId(reversed)).toEqual(byId(forward));
    expect(forward.map((c) => c.itemId)).toEqual(["n2", "pre"]);
    expect(forward[0].folded.map((f) => f.itemId)).not.toContain("pre");
  });

  it("ranks the folded item by the strongest score of every folded release, minors included", () => {
    const folded = foldReleases([
      nodemailer("n2", "10.1.2", { bucket: "security", score: 0.4 }),
      nodemailer("n7", "10.1.7", { score: 0.9 }),
    ]);
    expect(folded).toHaveLength(1);
    expect(folded[0].score).toBe(0.9);
    const [selected] = selectCandidates(folded, included, {}, noAlerts);
    expect(selected.rank).toBe(0.9);
  });

  it("keeps minor releases minor without a non-minor release of the package", () => {
    const input = [nodemailer("a", "10.1.3"), nodemailer("b", "10.1.4")];
    expect(foldReleases(input)).toEqual(input);
  });
});

describe("ref guard", () => {
  const resend = candidate({
    itemId: "resend",
    title: "resend/resend-node v6.34.0",
    url: "https://github.com/resend/resend-node/releases/tag/v6.34.0",
    sourceName: "resend/resend-node releases",
    sourceKind: "github_releases",
    matchReason: "release:resend",
    bucket: "breaking_or_feature",
    rawText: "Adds the inboxes API. Also fixes retries.",
    keys: { packages: ["resend"], services: [], source: "GitHub", topic: "breaking_or_feature" },
    repoIds: ["r1"],
  });

  it("derives identity tokens from keys, the GitHub source and the title", () => {
    expect(identityTokens(resend)).toEqual(["resend", "resend/resend-node", "resend-node"]);
    expect(
      identityTokens(
        candidate({
          title: "@sentry/react@10.2.0",
          matchReason: "release:@sentry/react+mention:sentry",
          sourceKind: "github_releases",
          sourceName: "getsentry/sentry-javascript releases",
        })
      )
    ).toEqual(
      expect.arrayContaining(["@sentry/react", "sentry/react", "react", "sentry-javascript"])
    );
    // Blog posts have no reliable identity; the guard does not apply to them.
    expect(identityTokens(candidate({ title: "Introducing Seer" }))).toEqual([]);
    expect(mentionsIdentity("anything", [])).toBe(true);
    expect(mentionsIdentity("Resend adds inboxes", ["resend"])).toBe(true);
    expect(mentionsIdentity("presendable", ["resend"])).toBe(false);
  });

  it("replaces model text about another item with the ref item's own title", () => {
    const pool = selectCandidates([resend], included, {}, noAlerts);
    const out: SynthesisOutput = {
      summary: "",
      act: [],
      know: [
        {
          ref: 1,
          headline: "nodemailer 10.1.2 bounds message work and token requests",
          line: "nodemailer limits message parsing work in garden.",
          what_to_do: { kind: "upgrade", note: "with the next deploy" },
        },
      ],
    };
    const { items, refMismatches } = assembleBulletin(out, pool);
    expect(items[0]).toMatchObject({
      itemId: "resend",
      section: "know",
      todo: "upgrade",
      action: "with the next deploy",
      headline: "resend/resend-node v6.34.0",
      line: "Adds the inboxes API.",
    });
    expect(refMismatches).toEqual([
      {
        itemId: "resend",
        text: "nodemailer 10.1.2 bounds message work and token requests nodemailer limits messa",
      },
    ]);
  });

  it("keeps model text that names the item, in act and know", () => {
    const pool = selectCandidates([resend], included, {}, noAlerts);
    const out: SynthesisOutput = {
      summary: "",
      act: [{ ref: 1, headline: "Inboxes API", line: "Resend-node adds it.", action: "Read it" }],
      know: [],
    };
    const { items, refMismatches } = assembleBulletin(out, pool);
    expect(items[0]).toMatchObject({ section: "act", headline: "Inboxes API" });
    expect(refMismatches).toEqual([]);
  });

  it("takes the first sentence, or nothing", () => {
    expect(firstSentence("One. Two.")).toBe("One.");
    expect(firstSentence("## What's Changed\n* bump deps")).toBe("");
  });
});

describe("runtime security items", () => {
  const runtimes = new Map([
    [
      "php",
      [
        {
          repoId: "r1",
          repo: "garden",
          name: "php",
          version: "8.3-fpm",
          normalized: "8.3",
          source: "Dockerfile",
          unresolved: false,
        },
      ],
    ],
  ]);
  const ctx = { ...noAlerts, runtimes };
  const runtimeItem = (over: Partial<Candidate>) =>
    candidate({
      bucket: "security",
      score: 1,
      sourceName: "PHP news",
      matchReason: "runtime:php",
      repoIds: ["r1"],
      keys: { packages: [], services: [], source: "PHP news", topic: "security" },
      ...over,
    });
  const pre = runtimeItem({
    itemId: "pre",
    contentHash: "pre",
    title: "Upcoming Critical PHP Security Release",
    publishedAt: new Date("2026-10-20T20:32:00Z"),
    runtimeMeta: { kind: "announcement", cveIds: [], severity: "critical", fixedVersions: [] },
  });
  const ghsa = runtimeItem({
    itemId: "ghsa",
    contentHash: "ghsa",
    title: "PHP security advisory: RCE via OOM corruption (CVE-2026-109618)",
    sourceName: "php/php-src security advisories",
    sourceKind: "github_advisories",
    publishedAt: new Date("2026-10-21T13:34:25Z"),
    runtimeMeta: {
      kind: "advisory",
      cveIds: ["CVE-2026-109618"],
      severity: "critical",
      fixedVersions: ["8.2.35", "8.3.36", "8.4.27", "8.5.12"],
    },
  });

  it("makes an affected runtime item must-act with the derived action", () => {
    expect(actSignals(ghsa, ctx)).toEqual({
      mustAct: true,
      suggestedAction:
        "garden: rebuild to pick up PHP 8.3.36; the php:8.3-fpm tag already points to it",
    });
  });

  it("is not must-act when the post concerns another release line", () => {
    const other = runtimeItem({
      title: "PHP 8.4.27 Released!",
      runtimeMeta: {
        kind: "announcement",
        cveIds: [],
        severity: "critical",
        fixedVersions: ["8.4.27"],
        lineSpecific: true,
      },
    });
    expect(actSignals(other, ctx)).toEqual({ mustAct: false, suggestedAction: null });
  });

  it("keeps one act item per runtime and folds the pre-announcement under it", () => {
    const selected = selectCandidates([pre, ghsa], included, {}, ctx);
    expect(selected.map((c) => [c.itemId, c.mustAct])).toEqual([
      ["ghsa", true],
      ["pre", false],
    ]);
    const assembled = assembleBulletin({ summary: "", act: [], know: [] }, selected);
    expect(assembled.items).toHaveLength(1);
    expect(assembled.items[0]).toMatchObject({
      itemId: "ghsa",
      section: "act",
      action: "garden: rebuild to pick up PHP 8.3.36; the php:8.3-fpm tag already points to it",
      foldedItemIds: ["pre"],
    });
  });
});

describe("upgrades per repo", () => {
  it("pairs a security act item's repos with installed and fixed versions", () => {
    const release = candidate({
      itemId: "fastify",
      bucket: "security",
      title: "fastify v5.12.6",
      sourceKind: "github_releases",
      matchReason: "release:fastify",
      repoIds: ["r1"],
      keys: { packages: ["fastify"], services: [], source: "fastify", topic: "security" },
    });
    const pool = selectCandidates(
      [release],
      included,
      {},
      {
        now: NOW,
        alertFixes: fixFor("fastify", "5.12.5", "5.8.5"),
      }
    );
    const [d] = assembleBulletin({ summary: "", act: [], know: [] }, pool).items;
    expect(d.action).toBe("npm i fastify@5.12.6");
    expect(itemUpgrades(d, pool[0], [])).toEqual([
      { repo: "garden", name: "fastify", installed: ["5.8.5"], target: "5.12.6" },
    ]);
  });

  it("lists exactly the item's affected repos: alerted repos join, unalerted ones stay (W43)", () => {
    // Sigma better-auth: both repos install it, only budget has an alert this period. Upgrades
    // used to list budget alone; forms-web was in affectedRepos and the line.
    const repos = new Map([
      ["e", "sigma/budget"],
      ["f", "sigma/forms-web"],
    ]);
    const release = candidate({
      itemId: "better-auth",
      bucket: "security",
      title: "better-auth/better-auth v1.7.12",
      sourceKind: "github_releases",
      matchReason: "release:better-auth",
      repoIds: ["e", "f"],
      keys: { packages: ["better-auth"], services: [], source: "better-auth", topic: "security" },
    });
    const pool = selectCandidates(
      [release],
      repos,
      {},
      {
        now: NOW,
        alertFixes: new Map([
          ["better-auth", [{ repo: "sigma/budget", installed: "1.4.9", fix: "1.7.12" }]],
        ]),
        alertInstalls: new Map([
          [
            "better-auth",
            new Map([
              ["sigma/budget", [{ version: "1.4.9", direct: true }]],
              ["sigma/forms-web", [{ version: "1.6.23", direct: true }]],
            ]),
          ],
        ]),
      }
    );
    const [d] = assembleBulletin({ summary: "", act: [], know: [] }, pool).items;
    expect(d.affectedRepos).toEqual(["sigma/budget", "sigma/forms-web"]);
    expect(itemUpgrades(d, pool[0], [])).toEqual([
      { repo: "sigma/budget", name: "better-auth", installed: ["1.4.9"], target: "1.7.12" },
      { repo: "sigma/forms-web", name: "better-auth", installed: ["1.6.23"], target: null },
    ]);
  });

  it("adds repos with an alert on the item's package to its affected repos (W43 payload)", () => {
    // The match recorded the repos of another package of the monorepo feed; the alerts are
    // on `payload` in three other repos. Both fields now name all of them.
    const repos = new Map([
      ["b", "bakery.example"],
      ["x", "clinic.example"],
      ["o", "orchid-hotel"],
    ]);
    const release = candidate({
      itemId: "payload",
      bucket: "security",
      title: "payloadcms/payload v3.92.0",
      sourceKind: "github_releases",
      matchReason: "release:@payloadcms/bundler-webpack",
      repoIds: ["b"],
      keys: { packages: ["payload"], services: [], source: "payload", topic: "security" },
    });
    const pool = selectCandidates(
      [release],
      repos,
      {},
      {
        now: NOW,
        alertFixes: new Map([
          [
            "payload",
            [
              { repo: "clinic.example", installed: "3.86.0", fix: "3.92.0" },
              { repo: "orchid-hotel", installed: "3.85.1", fix: "3.92.0" },
            ],
          ],
        ]),
      }
    );
    const [d] = assembleBulletin({ summary: "", act: [], know: [] }, pool).items;
    expect(d.affectedRepos).toEqual(["bakery.example", "clinic.example", "orchid-hotel"]);
    expect(itemUpgrades(d, pool[0], []).map((u) => [u.repo, u.installed, u.target])).toEqual([
      ["bakery.example", [], null],
      ["clinic.example", ["3.86.0"], "3.92.0"],
      ["orchid-hotel", ["3.85.1"], "3.92.0"],
    ]);
  });

  it("reads a release item's target from its install command and installed from the stack", () => {
    const release = candidate({
      itemId: "next",
      title: "v16.3.8",
      sourceKind: "github_releases",
      matchReason: "release:next",
      repoIds: ["r1", "r2"],
      keys: { packages: ["next"], services: [], source: "next", topic: "breaking_or_feature" },
    });
    const pool = selectCandidates([release], included, {}, noAlerts);
    const out = assembleBulletin(
      {
        summary: "",
        act: [],
        know: [
          {
            ref: 1,
            headline: "Next.js 16.3.8",
            line: "next 16.3.8 is out.",
            what_to_do: { kind: "upgrade", note: "npm i next@16.3.8" },
          },
        ],
      },
      pool
    );
    const stack = [{ name: "garden", dependencies: [{ name: "next", version: "15.2.3" }] }];
    expect(itemUpgrades(out.items[0], pool[0], stack)).toEqual([
      { repo: "garden", name: "next", installed: ["15.2.3"], target: "16.3.8" },
      { repo: "west", name: "next", installed: [], target: "16.3.8" },
    ]);
    // A "read" item recommends no version.
    expect(
      itemUpgrades({ ...out.items[0], todo: "read", action: "Read it" }, pool[0], stack)
    ).toEqual([]);
  });
  it("scopes a release item's upgrades to its matched package's ecosystem", () => {
    const release = candidate({
      itemId: "redis",
      title: "v4.7.0",
      sourceKind: "github_releases",
      matchReason: "release:redis",
      repoIds: ["r1", "r2"],
      keys: { packages: ["redis"], services: [], source: "redis", topic: "breaking_or_feature" },
      matchedPackage: { ecosystem: "npm", name: "redis" },
    });
    const pool = selectCandidates([release], included, {}, noAlerts);
    const out = assembleBulletin(
      {
        summary: "",
        act: [],
        know: [
          {
            ref: 1,
            headline: "redis 4.7.0",
            line: "redis 4.7.0 is out.",
            what_to_do: { kind: "upgrade", note: "npm i redis@4.7.0" },
          },
        ],
      },
      pool
    );
    const stack = [
      { name: "garden", dependencies: [{ name: "redis", version: "4.6.0" }] },
      {
        name: "west",
        dependencies: [
          { name: "redis", version: "5.0.0", ecosystem: "PyPI" as const, manager: "uv" as const },
        ],
      },
    ];
    expect(itemUpgrades(out.items[0], pool[0], stack)).toEqual([
      { repo: "garden", name: "redis", installed: ["4.6.0"], target: "4.7.0" },
      { repo: "west", name: "redis", installed: [], target: "4.7.0" },
    ]);
  });
});

describe("completeRepoNames", () => {
  const also = (repos: readonly string[]) => `Also affects ${repos.join(", ")}.`;
  const acme = [
    "bakery.example",
    "briff",
    "clinic.example",
    "garden.example",
    "west.garden.example",
  ];

  it("appends the affected repos a line leaves out (W43 i18next, openai)", () => {
    expect(
      completeRepoNames(
        "i18next 26 drops the legacy API used in briff, clinic.example, garden.example and west.garden.example.",
        acme,
        also
      )
    ).toBe(
      "i18next 26 drops the legacy API used in briff, clinic.example, garden.example and west.garden.example. Also affects bakery.example."
    );
    expect(
      completeRepoNames(
        "openai 6 removes the Assistants API that briff-reader calls",
        ["briff", "briff-reader", "office-ledger"],
        also
      )
    ).toBe(
      "openai 6 removes the Assistants API that briff-reader calls. Also affects briff, office-ledger."
    );
  });

  it("keeps a line that names every affected repo or none", () => {
    const all = "Affects garden.example and west.garden.example.";
    expect(completeRepoNames(all, ["garden.example", "west.garden.example"], also)).toBe(all);
    const none = "i18next 26 drops the legacy API.";
    expect(completeRepoNames(none, acme, also)).toBe(none);
    // west.garden.example does not name garden.example.
    expect(completeRepoNames("Affects west.garden.example.", ["garden.example"], also)).toBe(
      "Affects west.garden.example."
    );
  });

  it("repairs a model line in the assembled bulletin, after the ref guard", () => {
    const pool = selectCandidates(
      [
        candidate({
          itemId: "i18next",
          title: "i18next v26.0.0",
          sourceKind: "github_releases",
          matchReason: "release:i18next",
          repoIds: ["r1", "r2"],
          keys: {
            packages: ["i18next"],
            services: [],
            source: "i18next",
            topic: "breaking_or_feature",
          },
        }),
      ],
      included,
      {},
      noAlerts
    );
    const { items } = assembleBulletin(
      {
        summary: "",
        act: [],
        know: [
          {
            ref: 1,
            headline: "i18next 26 drops the legacy API",
            line: "i18next 26 drops the legacy API garden uses.",
            what_to_do: { kind: "upgrade", note: "when moving to i18next 26" },
          },
        ],
      },
      pool,
      undefined,
      (repos) => `Şunları da etkiliyor: ${repos.join(", ")}.`
    );
    expect(items[0].line).toBe(
      "i18next 26 drops the legacy API garden uses. Şunları da etkiliyor: west."
    );
  });
});

describe("W43 security headlines and actions (synthesis-v8)", () => {
  const ctx = { now: W43_NOW, alertFixes: W43_ALERT_FIXES };
  const selected = selectCandidates(W43_CANDIDATES, W43_REPOS, {}, ctx);
  const refOf = (id: string) => selected.findIndex((c) => c.itemId === id) + 1;
  const assembled = assembleBulletin(w43Output(refOf), selected).items;
  const item = (id: string) => assembled.find((i) => i.itemId === id);

  it("gives the model the fix versions per installed line", () => {
    const input = buildSynthesisInput({
      language: "en",
      week: "2026-W43",
      profileText: "",
      weights: {},
      stack: [],
      selected,
      minorCount: 0,
      alerts: [],
    });
    const fixes = Object.fromEntries(input.items.map((i) => [i.title, i.fix_versions]));
    expect(fixes).toEqual({
      "fastify v5.12.6": ["5.12.7"],
      "nodemailer v10.1.2": ["10.1.4"],
      "undici v8.12.2": ["7.30.1", "6.23.0"],
    });
  });

  it("names the fix, not the feed release, in the headline", () => {
    expect(item("fastify")?.headline).toBe(
      "Fastify 5.12.7 security release fixes GHSA-389g-gv7q-r4x8"
    );
    expect(item("nodemailer")?.headline).toBe(
      "Nodemailer 10.1.4 bounds message work and per-message auth"
    );
    expect(item("undici")?.headline).toBe(
      "undici 7.30.1 / 6.23.0 fixes TLS and denial-of-service security issues"
    );
    // Lines are not rewritten.
    expect(item("fastify")?.line).toBe(
      "The security fix ships in 5.12.7; garden.example runs 5.8.5."
    );
  });

  it("uses the per-line install command instead of the model's read sentence", () => {
    expect(item("fastify")?.action).toBe("npm i fastify@5.12.7");
    expect(item("nodemailer")?.action).toBe(
      "npm i nodemailer@10.1.4 (briff) · 9.x has no known fix, read the advisory: " +
        "garden.example, west.garden.example · transitive: mint-app, pantheon"
    );
    expect(item("undici")?.action).toBe(
      "npm i undici@7.30.1 (tracker) · npm i undici@6.23.0 (budget)"
    );
  });

  it("rewrites the title fallback too, when the model left the item out", () => {
    const items = assembleBulletin({ summary: "", act: [], know: [] }, selected).items;
    expect(items.find((i) => i.itemId === "fastify")?.headline).toBe("fastify 5.12.7");
  });

  it("rewrites must-act overflow that lands in rest as well", () => {
    const many = Array.from({ length: ACT_LIMIT + 1 }, (_, i) => ({
      ...W43_CANDIDATES[2],
      itemId: `undici-${i}`,
      contentHash: `h-${i}`,
    }));
    const pool = selectCandidates(many, W43_REPOS, {}, ctx);
    const rest = assembleBulletin({ summary: "", act: [], know: [] }, pool).items.filter(
      (i) => i.section === "rest"
    );
    expect(rest).toHaveLength(1);
    expect(rest[0].headline).toBe("undici 7.30.1 / 6.23.0");
  });
});

describe("boundHeadline", () => {
  const c = { title: "undici v8.12.2", folded: [], fixVersions: ["7.30.1"] };

  it("keeps a headline that names the fix, an installed version or no version", () => {
    expect(boundHeadline("undici 7.30.1 fixes TLS checks", c)).toBe(
      "undici 7.30.1 fixes TLS checks"
    );
    expect(boundHeadline("tracker runs undici 7.22.0", c)).toBe("tracker runs undici 7.22.0");
    expect(boundHeadline("undici fixes TLS checks", c)).toBe("undici fixes TLS checks");
  });

  it("replaces a folded release version as well, and nothing without fix versions", () => {
    const folded = { ...c, folded: [{ itemId: "f", title: "undici v8.12.1", url: "u" }] };
    expect(boundHeadline("undici 8.12.1 and later fix TLS", folded)).toBe(
      "undici 7.30.1 and later fix TLS"
    );
    expect(boundHeadline("undici v8.12.2 fixes TLS", { ...c, fixVersions: [] })).toBe(
      "undici v8.12.2 fixes TLS"
    );
  });
});

describe("fix command and affected repos without an alert", () => {
  it("lists the repos when a matched repo has no alert entry", () => {
    const payload = candidate({
      bucket: "security",
      title: "payload v3.92.0",
      sourceKind: "github_releases",
      matchReason: "release:payload",
      repoIds: ["r1", "r2"],
      keys: { packages: ["payload"], services: [], source: "payload", topic: "security" },
    });
    const alertFixes = new Map([
      ["payload", [{ repo: "garden", installed: "3.80.0", fix: "3.92.0", direct: true }]],
    ]);
    const [c] = selectCandidates([payload], included, {}, { now: NOW, alertFixes });
    expect(c.affectedRepos).toEqual(["garden", "west"]);
    expect(c.suggestedAction).toBe("npm i payload@3.92.0 (garden)");
  });
});

it("retains verified tags through ordinary Actions release upgrades and stored JSON", () => {
  const sha = "a".repeat(40);
  const release = candidate({
    itemId: "action",
    title: "acme/action v4.2.1",
    sourceKind: "github_releases",
    matchReason: "release:acme/action",
    matchedPackage: { name: "acme/action", ecosystem: "GitHub Actions" },
    repoIds: ["r1"],
    keys: {
      packages: ["acme/action"],
      services: [],
      source: "acme/action",
      topic: "breaking_or_feature",
    },
  });
  const selected = selectCandidates([release], new Map([["r1", "acme/web"]]), {}, noAlerts)[0];
  const upgrades = itemUpgrades(
    { section: "know", todo: "upgrade", action: "Update acme/action", affectedRepos: ["acme/web"] },
    selected,
    [
      {
        name: "acme/web",
        dependencies: [
          {
            name: "acme/action",
            ecosystem: "GitHub Actions",
            version: "4.1.0",
            actionTags: { "v4.2.1": sha },
          },
        ],
      },
    ]
  );
  expect(upgrades[0]).toMatchObject({ target: "4.2.1", actionTags: { "v4.2.1": sha } });
  expect(upgradeActions(parseUpgrades(JSON.parse(JSON.stringify(upgrades))))[0].text).toBe(
    `pin acme/action to v4.2.1 (sha ${sha})`
  );
});
