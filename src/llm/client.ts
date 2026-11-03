import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";

import { getEnv } from "@/lib/env";

import { createFakeLlm } from "./fake";

export type LlmTask = "triage" | "synthesis" | "profile";

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface JsonRequest<T> {
  task: LlmTask;
  model: string;
  system: string;
  /** JSON-encoded input; the prompt tells the model how to read it. */
  user: string;
  /** JSON schema for structured output (additionalProperties: false everywhere). */
  schema: Record<string, unknown>;
  /** Validates the decoded output (zod); throws on mismatch. */
  parse: (value: unknown) => T;
  maxTokens: number;
  effort: "low" | "medium" | "high";
}

export interface JsonResponse<T> {
  data: T;
  usage: LlmUsage;
  model: string;
}

/** One entry per request, in request order; a failed request never fails the batch. */
export type BatchEntry<T> = { ok: true; response: JsonResponse<T> } | { ok: false; error: Error };

export interface JsonBatchResult<T> {
  entries: BatchEntry<T>[];
  /** True when the requests went through the Message Batches API (billed at the batch rate). */
  batch: boolean;
}

export interface BatchOptions {
  /** Called after every status poll (job lock heartbeat). */
  onPoll?: () => Promise<void>;
  /** Poll interval cap; polling starts faster and backs off to this. */
  pollIntervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface LlmClient {
  readonly kind: "anthropic" | "fake";
  json<T>(request: JsonRequest<T>): Promise<JsonResponse<T>>;
  /** Submits all requests as one Message Batch and waits for it to end. */
  jsonBatch<T>(requests: JsonRequest<T>[], options?: BatchOptions): Promise<JsonBatchResult<T>>;
}

export class LlmOutputError extends Error {
  /** Set when the model answered (and billed) but the answer was unusable. */
  readonly billed?: { usage: LlmUsage; model: string };

  constructor(message: string, billed?: { usage: LlmUsage; model: string }) {
    super(message);
    this.name = "LlmOutputError";
    this.billed = billed;
  }
}

/** The usage of a request that was billed but failed to decode; null otherwise. */
export function billedUsage(err: unknown): { usage: LlmUsage; model: string } | null {
  return err instanceof LlmOutputError && err.billed ? err.billed : null;
}

/** The parts of a Messages API response that decoding needs (the SDK's Message fits). */
export interface ModelMessage {
  content: readonly { type: string; text?: string }[];
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
}

function messageParams<T>(req: JsonRequest<T>): MessageCreateParamsNonStreaming {
  return {
    model: req.model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: [{ role: "user", content: req.user }],
    output_config: { effort: req.effort, format: { type: "json_schema", schema: req.schema } },
  };
}

/** Same checks for the direct and the batch path: stop reason, JSON, then the zod parse. */
export function decodeMessage<T>(req: JsonRequest<T>, message: ModelMessage): JsonResponse<T> {
  const usage = {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };
  const billed = { usage, model: message.model };
  if (message.stop_reason === "refusal")
    throw new LlmOutputError(`${req.task}: model refused`, billed);
  if (message.stop_reason === "max_tokens") {
    throw new LlmOutputError(`${req.task}: output hit max_tokens (${req.maxTokens})`, billed);
  }
  const text = message.content
    .flatMap((b) => (b.type === "text" && b.text ? [b.text] : []))
    .join("");
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    throw new LlmOutputError(`${req.task}: output is not JSON`, billed);
  }
  try {
    return { data: req.parse(decoded), usage, model: message.model };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new LlmOutputError(`${req.task}: output does not match the schema: ${detail}`, billed);
  }
}

export type BatchItemResult =
  | { type: "succeeded"; message: ModelMessage }
  | { type: "errored"; message: string }
  | { type: "canceled" }
  | { type: "expired" };

export interface BatchSubmission {
  custom_id: string;
  params: MessageCreateParamsNonStreaming;
  /** The original request; only the fake transport reads it. */
  request: JsonRequest<unknown>;
}

/** The Message Batches API surface runBatch needs; the fake implements it in memory. */
export interface BatchTransport {
  readonly billedAsBatch: boolean;
  create(requests: BatchSubmission[]): Promise<string>;
  /** Processing status: `in_progress`, `canceling` or `ended`. */
  status(batchId: string): Promise<string>;
  results(batchId: string): AsyncIterable<{ custom_id: string; result: BatchItemResult }>;
  cancel(batchId: string): Promise<void>;
}

const POLL_START_MS = 5_000;
export const BATCH_POLL_MS = 30_000;
export const BATCH_TIMEOUT_MS = 60 * 60_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Submits one batch, polls until it ends (5s doubling up to 30s, at most 60 min;
 * on timeout the batch is canceled), and maps results back by custom_id. Errored,
 * expired, canceled or undecodable results become rejected entries.
 */
export async function runBatch<T>(
  transport: BatchTransport,
  requests: JsonRequest<T>[],
  options: BatchOptions = {}
): Promise<JsonBatchResult<T>> {
  if (requests.length === 0) return { entries: [], batch: transport.billedAsBatch };
  const sleep = options.sleep ?? defaultSleep;
  const cap = options.pollIntervalMs ?? BATCH_POLL_MS;
  const timeout = options.timeoutMs ?? BATCH_TIMEOUT_MS;
  // custom_id must match ^[a-zA-Z0-9_-]{1,64}$; the index keeps the mapping trivial.
  const ids = requests.map((_, i) => `r${i}`);
  const batchId = await transport.create(
    requests.map((request, i) => ({
      custom_id: ids[i],
      params: messageParams(request),
      request: request as JsonRequest<unknown>,
    }))
  );

  const started = Date.now();
  let wait = Math.min(POLL_START_MS, cap);
  let ended = false;
  try {
    while (!ended) {
      if (Date.now() - started >= timeout) break;
      await sleep(wait);
      wait = Math.min(wait * 2, cap);
      ended = (await transport.status(batchId)) === "ended";
      await options.onPoll?.();
    }
  } catch (err) {
    // E.g. the job lock was lost: nobody will read this batch, so stop paying for it.
    if (!ended) await transport.cancel(batchId).catch(() => undefined);
    throw err;
  }
  if (!ended) {
    await transport.cancel(batchId);
    const error = new LlmOutputError(`batch ${batchId} did not end within ${timeout / 60_000} min`);
    return { entries: requests.map(() => ({ ok: false, error })), batch: transport.billedAsBatch };
  }

  const byId = new Map<string, BatchItemResult>();
  for await (const line of transport.results(batchId)) byId.set(line.custom_id, line.result);
  const entries = requests.map((req, i): BatchEntry<T> => {
    const result = byId.get(ids[i]);
    if (!result) return { ok: false, error: new LlmOutputError(`${req.task}: no batch result`) };
    if (result.type !== "succeeded") {
      const detail = result.type === "errored" ? `: ${result.message}` : "";
      return { ok: false, error: new LlmOutputError(`${req.task}: batch ${result.type}${detail}`) };
    }
    try {
      return { ok: true, response: decodeMessage(req, result.message) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
    }
  });
  return { entries, batch: transport.billedAsBatch };
}

function anthropicTransport(client: Anthropic): BatchTransport {
  return {
    billedAsBatch: true,
    async create(requests) {
      const batch = await client.messages.batches.create({
        requests: requests.map(({ custom_id, params }) => ({ custom_id, params })),
      });
      return batch.id;
    },
    async status(batchId) {
      return (await client.messages.batches.retrieve(batchId)).processing_status;
    },
    async *results(batchId) {
      for await (const line of await client.messages.batches.results(batchId)) {
        const r = line.result;
        yield {
          custom_id: line.custom_id,
          result:
            r.type === "succeeded"
              ? { type: "succeeded", message: r.message }
              : r.type === "errored"
                ? { type: "errored", message: `${r.error.error.type}: ${r.error.error.message}` }
                : { type: r.type },
        };
      }
    },
    async cancel(batchId) {
      await client.messages.batches.cancel(batchId);
    },
  };
}

export function createAnthropicLlm(apiKey: string): LlmClient {
  const client = new Anthropic({ apiKey, maxRetries: 3, timeout: 5 * 60_000 });
  const transport = anthropicTransport(client);
  return {
    kind: "anthropic",
    async json<T>(req: JsonRequest<T>): Promise<JsonResponse<T>> {
      return decodeMessage(req, await client.messages.create(messageParams(req)));
    },
    jsonBatch: (requests, options) => runBatch(transport, requests, options),
  };
}

/**
 * Runs requests through one Message Batch when `batch` is set, else one call each
 * (sequentially, as before). Either way failures come back as rejected entries.
 */
export async function jsonMany<T>(
  client: LlmClient,
  requests: JsonRequest<T>[],
  options: BatchOptions & { batch: boolean }
): Promise<JsonBatchResult<T>> {
  if (options.batch) return client.jsonBatch(requests, options);
  const entries: BatchEntry<T>[] = [];
  for (const req of requests) {
    try {
      entries.push({ ok: true, response: await client.json(req) });
    } catch (err) {
      entries.push({ ok: false, error: err instanceof Error ? err : new Error(String(err)) });
    }
  }
  return { entries, batch: false };
}

export type LlmAvailability =
  { ok: true; client: LlmClient; batch: boolean } | { ok: false; reason: string };

/** The configured client: Anthropic when a key is set, the fake only outside production. */
export function getLlm(): LlmAvailability {
  const env = getEnv();
  if (env.BRIFF_LLM_FAKE) {
    if (env.NODE_ENV === "production")
      return { ok: false, reason: "BRIFF_LLM_FAKE is refused in production" };
    return { ok: true, client: createFakeLlm(), batch: env.BRIFF_LLM_BATCH };
  }
  if (!env.ANTHROPIC_API_KEY) return { ok: false, reason: "ANTHROPIC_API_KEY not set" };
  return {
    ok: true,
    client: createAnthropicLlm(env.ANTHROPIC_API_KEY),
    batch: env.BRIFF_LLM_BATCH,
  };
}

/**
 * Accumulates usage per task for Run.tokens. Usage that went through a Message
 * Batch also sets `batch: true` and `<task>:batch: true` (billed at 50%); the
 * batch path with the fake records `false`.
 */
export class TokenMeter {
  private totals: Record<string, number> = {};
  private flags: Record<string, boolean> = {};

  add(task: LlmTask, model: string, usage: LlmUsage, options: { batch?: boolean } = {}): void {
    const prefix = `${task}:${model}`;
    this.totals[`${prefix}:input`] = (this.totals[`${prefix}:input`] ?? 0) + usage.inputTokens;
    this.totals[`${prefix}:output`] = (this.totals[`${prefix}:output`] ?? 0) + usage.outputTokens;
    this.totals.input = (this.totals.input ?? 0) + usage.inputTokens;
    this.totals.output = (this.totals.output ?? 0) + usage.outputTokens;
    if (options.batch !== undefined) {
      this.flags.batch = (this.flags.batch ?? false) || options.batch;
      this.flags[`${task}:batch`] = (this.flags[`${task}:batch`] ?? false) || options.batch;
    }
  }

  toJSON(): Record<string, number | boolean> {
    return { ...this.totals, ...this.flags };
  }
}
