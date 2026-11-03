// Estimated LLM cost from token counts: the one price table Admin, the per-org usage rollup
// and the monthly budget read. Pure (no env, no database). Estimates only: the invoice from
// Anthropic is the truth, these keep an org's spend visible and bounded.

/** USD per million tokens. Matched by prefix, so a dated id (`claude-haiku-5-5-20261001`) counts. */
export const MODEL_PRICES: readonly { model: string; input: number; output: number }[] = [
  { model: "claude-haiku-5-5", input: 0.1, output: 0.5 },
  { model: "claude-sonnet-5-5", input: 2, output: 10 },
];

/** Message Batches are billed at half the price. */
export const BATCH_DISCOUNT = 0.5;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export function modelPrice(model: string): { input: number; output: number } | null {
  const row = MODEL_PRICES.find((p) => model === p.model || model.startsWith(`${p.model}-`));
  return row ? { input: row.input, output: row.output } : null;
}

/** Cost of one request's usage; null for a model without a price (the fake, an unknown id). */
export function requestUsd(model: string, usage: TokenUsage, batch: boolean): number | null {
  const price = modelPrice(model);
  if (!price) return null;
  const usd = (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
  return batch ? usd * BATCH_DISCOUNT : usd;
}

export interface CostLine {
  /** `triage:claude-haiku-5-5` */
  key: string;
  task: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  batch: boolean;
  /** 0 when unpriced. */
  usd: number;
  priced: boolean;
}

export interface UsdEstimate {
  usd: number;
  inputTokens: number;
  outputTokens: number;
  lines: CostLine[];
  /** `task:model` keys without a price, counted as 0. */
  unpriced: string[];
}

/**
 * Estimate for one `Run.tokens` value (TokenMeter.toJSON): `<task>:<model>:input|output` counts
 * and `<task>:batch` flags. The bare `input` / `output` totals and anything else are ignored.
 */
export function estimateUsd(tokens: unknown): UsdEstimate {
  return sumEstimates([tokens]);
}

/** Several `Run.tokens` values summed per task:model (Admin's monthly card). */
export function sumEstimates(runs: readonly unknown[]): UsdEstimate {
  const lines = new Map<string, CostLine>();
  for (const tokens of runs) {
    if (typeof tokens !== "object" || tokens === null || Array.isArray(tokens)) continue;
    const record = tokens as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      const m = /^([a-z]+):(.+):(input|output)$/.exec(key);
      if (!m || typeof value !== "number" || !Number.isFinite(value)) continue;
      const [, task, model, side] = m;
      const batch = record[`${task}:batch`] === true;
      // Batch and direct calls of one model are priced apart.
      const lineKey = `${task}:${model}${batch ? ":batch" : ""}`;
      const line = lines.get(lineKey) ?? {
        key: `${task}:${model}`,
        task,
        model,
        inputTokens: 0,
        outputTokens: 0,
        batch,
        usd: 0,
        priced: modelPrice(model) !== null,
      };
      if (side === "input") line.inputTokens += value;
      else line.outputTokens += value;
      lines.set(lineKey, line);
    }
  }
  const out = [...lines.values()];
  for (const line of out) line.usd = requestUsd(line.model, line, line.batch) ?? 0;
  out.sort((a, b) => b.usd - a.usd || a.key.localeCompare(b.key));
  return {
    usd: out.reduce((s, l) => s + l.usd, 0),
    inputTokens: out.reduce((s, l) => s + l.inputTokens, 0),
    outputTokens: out.reduce((s, l) => s + l.outputTokens, 0),
    lines: out,
    unpriced: [...new Set(out.filter((l) => !l.priced).map((l) => l.key))],
  };
}

/** Stored as integer micro-dollars (OrgUsage.estimatedUsdMicros). */
export function toMicros(usd: number): number {
  return Math.round(usd * 1_000_000);
}

export function fromMicros(micros: number): number {
  return micros / 1_000_000;
}

/** "$0.42", "$12.30", "<$0.01" for a cost that rounds to nothing but is not zero. */
export function formatUsd(usd: number): string {
  if (usd > 0 && usd < 0.005) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}
