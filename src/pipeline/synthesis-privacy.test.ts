import { describe, expect, it } from "vitest";

import { createFakeLlm } from "@/llm/fake";

import {
  assembleBulletin,
  buildSynthesisInput,
  selectCandidates,
  type Candidate,
  type SynthesisOutput,
} from "./bulletin";
import type { RepoFix } from "./fixes";
import { pseudonymiseSynthesisInput, restoreSynthesisOutput } from "./synthesis-privacy";
import { synthesisRequest, type PreparedStream } from "./weekly";

const NOW = new Date("2026-10-19T04:00:00Z");
const REPOS = new Map([
  ["r1", "garden.example"],
  ["r2", "sigma/pantheon"],
  ["r3", "west.garden.example"],
]);

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

function fixture() {
  const alertFixes = new Map<string, RepoFix[]>([
    [
      "express",
      [
        { repo: "garden.example", installed: "4.18.0", fix: "4.21.2", direct: true },
        { repo: "sigma/pantheon", installed: "4.18.0", fix: "4.21.2", direct: true },
      ],
    ],
  ]);
  const selected = selectCandidates(
    [
      candidate({
        itemId: "express",
        bucket: "deadline",
        dueAt: new Date("2026-10-25T00:00:00Z"),
        dueWhat: "Move off express 4.18 in every affected repo",
        title: "express 4.21.2",
        sourceName: "expressjs/express releases",
        sourceKind: "github_releases",
        matchReason: "release:express",
        repoIds: ["r1", "r2"],
        keys: { packages: ["express"], services: [], source: "x", topic: "breaking_or_feature" },
      }),
      candidate({
        itemId: "next",
        title: "Next.js 16.5",
        repoIds: ["r1", "r2", "r3"],
        keys: { packages: ["next"], services: [], source: "x", topic: "breaking_or_feature" },
      }),
    ],
    REPOS,
    {},
    { now: NOW, alertFixes }
  );
  const input = buildSynthesisInput({
    language: "en",
    week: "2026-W43",
    profileText: "Mostly cares about garden.example and pantheon; less about Expo.",
    weights: { "package:next": 1 },
    stack: [
      { name: "garden.example", dependencies: [{ name: "next", version: "15.2.3" }], services: [] },
      {
        name: "sigma/pantheon",
        dependencies: [{ name: "express", version: "4.18.0" }],
        services: [],
      },
      { name: "west.garden.example", dependencies: [], services: [] },
    ],
    selected,
    minorCount: 0,
    alerts: [
      {
        package: "express",
        severity: "high",
        osvId: "GHSA-1",
        repos: ["garden.example"],
        fixed: "4.21.2",
      },
    ],
  });
  return { selected, input };
}

describe("pseudonymiseSynthesisInput", () => {
  it("leaves no repo name in the payload and keeps packages, versions and advisories", () => {
    const { input } = fixture();
    const { input: out } = pseudonymiseSynthesisInput(input);
    const json = JSON.stringify(out);
    for (const name of ["garden", "pantheon", "west", "sigma"]) expect(json).not.toContain(name);
    expect(out.stack.map((r) => r.name)).toEqual(["repo-1", "repo-2", "repo-3"]);
    expect(out.profile.text).toBe("Mostly cares about repo-1 and repo-2; less about Expo.");
    expect(out.security_alerts[0]).toMatchObject({
      package: "express",
      osvId: "GHSA-1",
      repos: ["repo-1"],
    });
    expect(json).toContain("next@15.2.3");
    expect(json).toContain("express@4.18.0");
    // Same input, same aliases.
    expect(JSON.stringify(pseudonymiseSynthesisInput(input).input)).toBe(json);
  });

  it("aliases org repos outside the stream that the profile names", () => {
    const { input } = fixture();
    const withProfile = {
      ...input,
      profile: { ...input.profile, text: "Prioritise acme/private-ledger over garden.example." },
    };
    const { input: out, aliases } = pseudonymiseSynthesisInput(withProfile, [
      "acme/private-ledger",
      "garden.example",
    ]);
    expect(JSON.stringify(out)).not.toMatch(/ledger|garden/);
    expect(aliases.restoreText(out.profile.text)).toBe(withProfile.profile.text);
  });

  it("keeps runtime and image names apart from a repo with the same basename", () => {
    const { input } = fixture();
    const withRuntime = {
      ...input,
      stack: [
        ...input.stack,
        { name: "acme/node", packages: [], services: [], runtimes: ["node 22"] },
      ],
      items: input.items.map((i, n) =>
        n === 0
          ? { ...i, suggested_action: "acme/node: move Dockerfile to node:22.23.4-alpine" }
          : i
      ),
    };
    const { input: out, aliases } = pseudonymiseSynthesisInput(withRuntime);
    const action = out.items[0].suggested_action ?? "";
    expect(action).toBe(`${aliases.alias("acme/node")}: move Dockerfile to node:22.23.4-alpine`);
    expect(aliases.restoreText(action)).toBe("acme/node: move Dockerfile to node:22.23.4-alpine");
  });

  it("protects weighted and installed package names in the profile text", () => {
    const { input } = fixture();
    const text = "Prioritize @acme/web-sdk and @acme/ui-kit.";
    const withProfile = {
      ...input,
      stack: [...input.stack, { name: "private/web", packages: [], services: [] }],
      profile: { text, weights: { "package:@acme/web-sdk": 1 } },
    };
    const { input: out } = pseudonymiseSynthesisInput(
      {
        ...withProfile,
        stack: [...withProfile.stack, { name: "acme/ui", packages: [], services: [] }],
      },
      [],
      ["@acme/ui-kit"]
    );
    expect(out.profile.text).toBe(text);
  });

  it("skips alias numbers the input already contains", () => {
    const { input } = fixture();
    const { input: out } = pseudonymiseSynthesisInput({
      ...input,
      profile: { ...input.profile, text: "See https://example.com/repo-1/notes" },
    });
    expect(out.stack.map((r) => r.name)).toEqual(["repo-2", "repo-3", "repo-4"]);
    expect(out.profile.text).toBe("See https://example.com/repo-1/notes");
  });

  it("maps aliases back in every free-text field", () => {
    const { input } = fixture();
    const { aliases } = pseudonymiseSynthesisInput(input);
    const out: SynthesisOutput = {
      summary: "A fix for express affects repo-1 and repo-2.",
      act: [
        {
          ref: 1,
          headline: "express 4.21.2 in repo-1",
          line: "repo-2 too.",
          action: "Update repo-3",
        },
      ],
      know: [
        {
          ref: 2,
          headline: "h repo-1",
          line: "l repo-2",
          what_to_do: { kind: "upgrade", note: "when moving repo-3" },
        },
      ],
    };
    expect(restoreSynthesisOutput(out, aliases)).toEqual({
      summary: "A fix for express affects garden.example and sigma/pantheon.",
      act: [
        {
          ref: 1,
          headline: "express 4.21.2 in garden.example",
          line: "sigma/pantheon too.",
          action: "Update west.garden.example",
        },
      ],
      know: [
        {
          ref: 2,
          headline: "h garden.example",
          line: "l sigma/pantheon",
          what_to_do: { kind: "upgrade", note: "when moving west.garden.example" },
        },
      ],
    });
  });

  it("keeps the subset rule and the ref guard working under aliases", async () => {
    const { input, selected } = fixture();
    const prepared = {
      input,
      orgRepoNames: [] as string[],
      stack: [],
    } as unknown as PreparedStream;
    const req = synthesisRequest(prepared, "m", "system");
    // The model sees aliases only and writes a sentence naming one of two affected repos.
    const sent = JSON.parse(req.user) as typeof input;
    expect(sent.items[0].affected_repos).toEqual(["repo-1", "repo-2"]);
    const data = req.parse({
      summary: "express in repo-1.",
      act: [
        {
          ref: 1,
          headline: "express 4.21.2 fixes a bug",
          line: "express 4.21.2 matters for repo-1.",
          action: "Upgrade express in repo-1",
        },
        // Ref 2 is not about express: the ref guard does not apply to non-release items.
        {
          ref: 2,
          headline: "Next.js 16.5 ships",
          line: "Affects repo-3.",
          action: "Read the notes",
        },
      ],
      know: [],
    });
    const { items, summary } = assembleBulletin(data, selected, () => "fallback");
    expect(summary).toBe("express in garden.example.");
    const express = items.find((i) => i.itemId === "express");
    // Naming one of two affected repos (after restoring) falls back to the derived step,
    // and the line gets the repo it left out.
    expect(express?.action).toBe("Move off express 4.18 in every affected repo");
    expect(express?.line).toBe(
      "express 4.21.2 matters for garden.example. Also affects sigma/pantheon."
    );
    expect(items.find((i) => i.itemId === "next")?.line).toBe(
      "Affects west.garden.example. Also affects garden.example, sigma/pantheon."
    );
  });

  it("synthesisRequest protects every installed direct dependency", () => {
    const { input } = fixture();
    const text = "Prioritize @acme/web-sdk.";
    const prepared = {
      input: {
        ...input,
        profile: { text, weights: {} },
        stack: [...input.stack, { name: "private/web", packages: [], services: [] }],
      },
      orgRepoNames: [] as string[],
      stack: [
        {
          name: "private/web",
          dependencies: [{ name: "@acme/web-sdk", version: "1.0.0" }],
          services: [],
        },
      ],
    } as unknown as PreparedStream;
    const sent = JSON.parse(synthesisRequest(prepared, "m", "s").user) as typeof input;
    expect(sent.profile.text).toBe(text);
  });

  it("goes through the fake client end to end", async () => {
    const { input } = fixture();
    const res = await createFakeLlm().json(
      synthesisRequest(
        { input, orgRepoNames: [] as string[], stack: [] } as unknown as PreparedStream,
        "m",
        "s"
      )
    );
    expect(JSON.stringify(res.data)).not.toMatch(/repo-\d/);
  });
});
