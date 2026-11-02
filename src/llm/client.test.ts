import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  billedUsage,
  decodeMessage,
  jsonMany,
  runBatch,
  TokenMeter,
  type BatchItemResult,
  type BatchSubmission,
  type BatchTransport,
  type JsonRequest,
  type LlmClient,
} from "./client";
import { createFakeLlm } from "./fake";

const request = (n: number): JsonRequest<{ n: number }> => ({
  task: "triage",
  model: "m",
  system: "s",
  user: JSON.stringify({ n }),
  schema: { type: "object" },
  parse: (v) => z.object({ n: z.number() }).parse(v),
  maxTokens: 100,
  effort: "low",
});

const message = (text: string, stop = "end_turn") => ({
  content: [{ type: "text", text }],
  stop_reason: stop,
  usage: { input_tokens: 10, output_tokens: 2 },
  model: "m-1",
});

/** Ends after `pollsUntilEnd` polls; results are produced by `answer` and returned reversed. */
function scriptedTransport(
  answer: (s: BatchSubmission) => BatchItemResult | null,
  pollsUntilEnd = 2
) {
  const state = { submitted: [] as BatchSubmission[], polls: 0, canceled: false };
  const transport: BatchTransport = {
    billedAsBatch: true,
    async create(requests) {
      state.submitted = requests;
      return "batch_1";
    },
    async status() {
      state.polls++;
      return state.polls >= pollsUntilEnd ? "ended" : "in_progress";
    },
    async *results() {
      for (const s of [...state.submitted].reverse()) {
        const result = answer(s);
        if (result) yield { custom_id: s.custom_id, result };
      }
    },
    async cancel() {
      state.canceled = true;
    },
  };
  return { transport, state };
}

const noSleep = async () => {};

describe("runBatch", () => {
  it("maps results back by custom_id and surfaces per-item failures as rejected entries", async () => {
    const { transport, state } = scriptedTransport((s) => {
      const n = (JSON.parse(s.request.user) as { n: number }).n;
      if (n === 1) return { type: "errored", message: "overloaded_error: busy" };
      if (n === 2) return { type: "expired" };
      if (n === 3) return { type: "succeeded", message: message("not json") };
      if (n === 4) return null; // missing from the results file
      return { type: "succeeded", message: message(JSON.stringify({ n })) };
    });
    const res = await runBatch(transport, [0, 1, 2, 3, 4, 5].map(request), { sleep: noSleep });
    expect(res.batch).toBe(true);
    expect(state.submitted.map((s) => s.custom_id)).toEqual(["r0", "r1", "r2", "r3", "r4", "r5"]);
    expect(state.submitted[0].params).toMatchObject({ model: "m", max_tokens: 100 });
    expect(res.entries.map((e) => e.ok)).toEqual([true, false, false, false, false, true]);
    const [first, errored, expired, notJson, missing, last] = res.entries;
    expect(first.ok && first.response).toEqual({
      data: { n: 0 },
      usage: { inputTokens: 10, outputTokens: 2 },
      model: "m-1",
    });
    expect(last.ok && last.response.data).toEqual({ n: 5 });
    expect(!errored.ok && errored.error.message).toContain("overloaded_error");
    expect(!expired.ok && expired.error.message).toContain("expired");
    expect(!notJson.ok && notJson.error.message).toContain("not JSON");
    expect(!missing.ok && missing.error.message).toContain("no batch result");
  });

  it("calls onPoll after every status check (job lock heartbeat) and backs off", async () => {
    const { transport } = scriptedTransport(
      () => ({ type: "succeeded", message: message('{"n":1}') }),
      4
    );
    const waits: number[] = [];
    let beats = 0;
    await runBatch(transport, [request(1)], {
      sleep: async (ms) => {
        waits.push(ms);
      },
      onPoll: async () => {
        beats++;
      },
    });
    expect(beats).toBe(4);
    expect(waits).toEqual([5_000, 10_000, 20_000, 30_000]);
  });

  it("cancels a batch that does not end in time and rejects every entry", async () => {
    const { transport, state } = scriptedTransport(() => null, Number.POSITIVE_INFINITY);
    let clock = 0;
    const realNow = Date.now;
    Date.now = () => clock;
    try {
      const res = await runBatch(transport, [request(1), request(2)], {
        timeoutMs: 60_000,
        sleep: async (ms) => {
          clock += ms;
        },
      });
      expect(state.canceled).toBe(true);
      expect(res.entries.every((e) => !e.ok)).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });
});

describe("runBatch heartbeat failure", () => {
  it("cancels the batch and rethrows when onPoll throws (job lock lost)", async () => {
    const { transport, state } = scriptedTransport(() => null, Number.POSITIVE_INFINITY);
    await expect(
      runBatch(transport, [request(1)], {
        sleep: noSleep,
        onPoll: async () => {
          throw new Error("lock lost");
        },
      })
    ).rejects.toThrow("lock lost");
    expect(state.canceled).toBe(true);
  });
});

describe("jsonMany", () => {
  it("falls back to one call per request without batching and keeps failures per entry", async () => {
    let calls = 0;
    const client: LlmClient = {
      kind: "fake",
      async json<T>(req: JsonRequest<T>) {
        calls++;
        if (req.user.includes("2")) throw new Error("boom");
        return {
          data: req.parse(JSON.parse(req.user)),
          usage: { inputTokens: 1, outputTokens: 1 },
          model: "m",
        };
      },
      async jsonBatch() {
        throw new Error("must not batch");
      },
    };
    const res = await jsonMany(client, [request(1), request(2)], { batch: false });
    expect(calls).toBe(2);
    expect(res.batch).toBe(false);
    expect(res.entries.map((e) => e.ok)).toEqual([true, false]);
  });

  it("runs the fake through the batch path, unbilled as batch", async () => {
    const fake = createFakeLlm();
    const triage = (title: string): JsonRequest<unknown> => ({
      ...request(0),
      user: JSON.stringify({ items: [{ ref: 1, title }] }),
      parse: (v) => v,
    });
    const res = await jsonMany(fake, [triage("CVE-2026-1 fix"), triage("Docs typo")], {
      batch: true,
    });
    expect(res.batch).toBe(false);
    expect(res.entries).toMatchObject([
      { ok: true, response: { data: { results: [{ bucket: "security" }] }, model: "fake:m" } },
      { ok: true, response: { data: { results: [{ bucket: "minor" }] } } },
    ]);
    const broken = await fake.jsonBatch([{ ...request(0), user: "not json" }]);
    expect(broken.entries[0].ok).toBe(false);
  });
});

describe("TokenMeter", () => {
  it("adds batch markers only for usage that went through the batch path", () => {
    const meter = new TokenMeter();
    meter.add("profile", "haiku", { inputTokens: 5, outputTokens: 1 });
    expect(meter.toJSON()).not.toHaveProperty("batch");
    meter.add("synthesis", "sonnet", { inputTokens: 100, outputTokens: 10 }, { batch: true });
    expect(meter.toJSON()).toMatchObject({
      "synthesis:sonnet:input": 100,
      input: 105,
      batch: true,
      "synthesis:batch": true,
    });
    expect(meter.toJSON()).not.toHaveProperty("profile:batch");
  });
});

describe("billed usage of unusable answers", () => {
  it("keeps the usage on every decode failure, and only there", () => {
    const failing = [
      message('{"n":1}', "max_tokens"),
      message("not json"),
      message('{"n":"x"}'),
      message("", "refusal"),
    ];
    for (const m of failing) {
      let caught: unknown;
      try {
        decodeMessage(request(1), m);
      } catch (err) {
        caught = err;
      }
      expect(billedUsage(caught)).toEqual({
        usage: { inputTokens: 10, outputTokens: 2 },
        model: "m-1",
      });
    }
    expect(decodeMessage(request(1), message('{"n":1}')).data).toEqual({ n: 1 });
    expect(billedUsage(new Error("network"))).toBeNull();
  });
});
