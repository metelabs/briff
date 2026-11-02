import { describe, expect, it } from "vitest";

import { estimateUsd, formatUsd, modelPrice, requestUsd, sumEstimates, toMicros } from "./pricing";

describe("LLM pricing", () => {
  it("prices Haiku and Sonnet per million tokens, dated ids included", () => {
    expect(modelPrice("claude-haiku-5-5")).toEqual({ input: 0.1, output: 0.5 });
    expect(modelPrice("claude-sonnet-5-5-20261001")).toEqual({ input: 2, output: 10 });
    expect(modelPrice("claude-sonnet-5-50")).toBeNull();
    expect(modelPrice("fake:claude-haiku-5-5")).toBeNull();
    expect(requestUsd("claude-sonnet-5-5", { inputTokens: 1e6, outputTokens: 1e5 }, false)).toBe(3);
    expect(requestUsd("claude-sonnet-5-5", { inputTokens: 1e6, outputTokens: 1e5 }, true)).toBe(
      1.5
    );
    expect(requestUsd("gpt-x", { inputTokens: 1e6, outputTokens: 0 }, false)).toBeNull();
  });

  it("matches the 30 days measured on production (about one dollar)", () => {
    const month = sumEstimates([
      {
        input: 765_000,
        output: 169_000,
        "triage:claude-haiku-5-5:input": 765_000,
        "triage:claude-haiku-5-5:output": 169_000,
      },
      {
        "synthesis:claude-haiku-5-5:input": 325_000,
        "synthesis:claude-haiku-5-5:output": 148_000,
        "synthesis:claude-sonnet-5-5:input": 268_000,
        "synthesis:claude-sonnet-5-5:output": 15_000,
      },
    ]);
    expect(month.usd).toBeCloseTo(0.954, 3);
    expect(month.lines.map((l) => [l.key, Number(l.usd.toFixed(4))])).toEqual([
      ["synthesis:claude-sonnet-5-5", 0.686],
      ["triage:claude-haiku-5-5", 0.161],
      ["synthesis:claude-haiku-5-5", 0.1065],
    ]);
    expect(month.inputTokens).toBe(1_358_000);
    expect(month.unpriced).toEqual([]);
  });

  it("halves a task that went through a Message Batch, per task", () => {
    const run = estimateUsd({
      batch: true,
      "triage:batch": true,
      "triage:claude-haiku-5-5:input": 1_000_000,
      "triage:claude-haiku-5-5:output": 0,
      "profile:claude-haiku-5-5:input": 1_000_000,
      "profile:claude-haiku-5-5:output": 0,
    });
    expect(run.lines.find((l) => l.task === "triage")).toMatchObject({ batch: true, usd: 0.05 });
    expect(run.lines.find((l) => l.task === "profile")).toMatchObject({ batch: false, usd: 0.1 });
    expect(run.usd).toBeCloseTo(0.15, 10);
  });

  it("counts unknown models as zero and lists them as unpriced", () => {
    const run = estimateUsd({
      input: 10,
      output: 5,
      "synthesis:batch": false,
      "synthesis:fake:claude-sonnet-5-5:input": 10,
      "synthesis:fake:claude-sonnet-5-5:output": 5,
    });
    expect(run.usd).toBe(0);
    expect(run.unpriced).toEqual(["synthesis:fake:claude-sonnet-5-5"]);
    expect(run.lines[0]).toMatchObject({ model: "fake:claude-sonnet-5-5", inputTokens: 10 });
    expect(estimateUsd(null).lines).toEqual([]);
    expect(estimateUsd("x").usd).toBe(0);
  });

  it("formats and stores amounts", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.004)).toBe("<$0.01");
    expect(formatUsd(3)).toBe("$3.00");
    expect(toMicros(0.1234567)).toBe(123457);
  });
});
