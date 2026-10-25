import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { JsonRequest, LlmClient } from "@/llm/client";

import {
  classifyBatch,
  isUrgentBucket,
  splitRuleMinor,
  triageInput,
  urgentForOrg,
  type TriageCandidate,
} from "./triage";
import { interpretTriage, parseDueDate, triageOutputSchema } from "./triage-schema";

const fixture: unknown = JSON.parse(
  readFileSync(path.join(__dirname, "__fixtures__", "triage-response.json"), "utf8")
);

describe("triage output validation", () => {
  it("accepts the recorded response shape", () => {
    expect(() => triageOutputSchema.parse(fixture)).not.toThrow();
  });

  it("rejects unknown buckets and missing fields", () => {
    expect(() =>
      triageOutputSchema.parse({
        results: [{ ref: 1, bucket: "news", reason: "", packages: [], deadline: null }],
      })
    ).toThrow();
    expect(() => triageOutputSchema.parse({ results: [{ ref: 1, bucket: "minor" }] })).toThrow();
    expect(() => triageOutputSchema.parse({ items: [] })).toThrow();
  });

  it("keeps one decision per requested ref and demotes deadlines without a valid date", () => {
    const decisions = interpretTriage([1, 2, 3, 4, 5], triageOutputSchema.parse(fixture));
    expect(decisions.map((d) => [d.ref, d.bucket])).toEqual([
      [1, "security"],
      [2, "deadline"],
      [3, "breaking_or_feature"],
      [4, "minor"],
      [5, "breaking_or_feature"],
    ]);
    const deadline = decisions[1];
    expect(deadline.dueAt?.toISOString()).toBe("2026-08-31T00:00:00.000Z");
    expect(deadline.dueWhat).toMatch(/API level 36/);
    expect(decisions[3].packages).toEqual(["expo-router"]);
    expect(decisions[2].dueAt).toBeNull();
  });

  it("parses only real calendar dates", () => {
    expect(parseDueDate("2026-12-01")?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(parseDueDate("2026-02-31")).toBeNull();
    expect(parseDueDate("31.12.2026")).toBeNull();
    expect(parseDueDate("2026-1-5")).toBeNull();
  });
});

describe("classifyBatch with a mocked LLM", () => {
  const batch: TriageCandidate[] = [1, 2, 3, 4, 5].map((n) => ({
    id: `item${n}`,
    title: `Item ${n}`,
    url: `https://example.com/${n}`,
    rawText: "x".repeat(5000),
    publishedAt: new Date("2026-10-10T00:00:00Z"),
    sourceName: "Example",
    matchedVia: "release:next",
  }));

  it("sends structured-output requests and validates the response", async () => {
    const requests: JsonRequest<unknown>[] = [];
    const llm: LlmClient = {
      kind: "fake",
      async json<T>(req: JsonRequest<T>) {
        requests.push(req as JsonRequest<unknown>);
        return {
          data: req.parse(fixture),
          usage: { inputTokens: 1200, outputTokens: 300 },
          model: req.model,
        };
      },
      async jsonBatch() {
        throw new Error("not used");
      },
    };
    const res = await classifyBatch(
      llm,
      "claude-haiku-5-5",
      batch,
      new Date("2026-10-15T00:00:00Z")
    );
    expect(res.decisions).toHaveLength(5);
    expect(res.usage).toEqual({ inputTokens: 1200, outputTokens: 300 });
    expect(requests[0].task).toBe("triage");
    expect(requests[0].schema).toMatchObject({ type: "object", additionalProperties: false });
    const input = JSON.parse(requests[0].user) as {
      today: string;
      items: { ref: number; text: string }[];
    };
    expect(input.today).toBe("2026-10-15");
    expect(input.items.map((i) => i.ref)).toEqual([1, 2, 3, 4, 5]);
    expect(input.items[0].text.length).toBe(1500);
  });

  it("surfaces an invalid model response as an error", async () => {
    const llm: LlmClient = {
      kind: "fake",
      async json<T>(req: JsonRequest<T>) {
        return {
          data: req.parse({ results: [{ ref: 1, bucket: "nope" }] }),
          usage: { inputTokens: 0, outputTokens: 0 },
          model: "m",
        };
      },
      async jsonBatch() {
        throw new Error("not used");
      },
    };
    await expect(classifyBatch(llm, "m", batch, new Date())).rejects.toThrow();
  });

  it("numbers items from 1 in the model input", () => {
    const input = JSON.parse(triageInput(batch.slice(0, 2), new Date("2026-10-15T00:00:00Z"))) as {
      items: { ref: number; published: string }[];
    };
    expect(input.items).toMatchObject([{ ref: 1, published: "2026-10-10" }, { ref: 2 }]);
  });
});

describe("urgentForOrg", () => {
  const urgent = [
    {
      itemId: "a",
      title: "A",
      url: "https://a",
      sourceName: "S",
      bucket: "security" as const,
      reason: "r",
    },
    {
      itemId: "b",
      title: "B",
      url: "https://b",
      sourceName: "S",
      bucket: "security" as const,
      reason: "r",
    },
    {
      itemId: "c",
      title: "C",
      url: "https://c",
      sourceName: "S",
      bucket: "security" as const,
      reason: "r",
    },
  ];
  it("keeps matched items that reach an included repo or the whole stack", () => {
    const items = urgentForOrg(
      urgent,
      [
        { itemId: "a", repoIds: ["r1", "r2"] },
        { itemId: "b", repoIds: [] },
        { itemId: "c", repoIds: ["r3"] },
      ],
      new Map([["r1", "garden"]])
    );
    expect(items.map((i) => [i.title, i.affectedRepos])).toEqual([
      ["A", ["garden"]],
      ["B", []],
    ]);
  });
});

describe("isUrgentBucket", () => {
  it("lets only security interrupt the week", () => {
    expect(isUrgentBucket("security")).toBe(true);
    expect(isUrgentBucket("model_or_pricing")).toBe(false);
    expect(isUrgentBucket("breaking_or_feature")).toBe(false);
    expect(isUrgentBucket("deadline")).toBe(false);
    expect(isUrgentBucket("minor")).toBe(false);
  });
});

describe("splitRuleMinor", () => {
  it("routes pre-release and commit-sha tag titles past the model, with a reason", () => {
    const { ruled, rest } = splitRuleMinor([
      { title: "vercel/next.js v16.1.0-canary.12" },
      { title: "vercel/next.js v16.0.3" },
      { title: "expo@55.0.0-beta.3" },
      {
        title:
          "baml-language-source-481d074234fce9df31ee0ab0da5f29c5d5fe1e4d: Deliver owned spans to BCS (#5310)",
      },
    ]);
    expect(ruled.map((r) => r.reason)).toEqual(["pre-release", "pre-release", "sha-tag"]);
    expect(ruled[2].item.title).toMatch(/^baml-language-source-481d0742/);
    expect(rest.map((c) => c.title)).toEqual(["vercel/next.js v16.0.3"]);
  });
});
