import {
  decodeMessage,
  runBatch,
  type BatchItemResult,
  type BatchTransport,
  type JsonRequest,
  type JsonResponse,
  type LlmClient,
  type ModelMessage,
} from "./client";

// Deterministic stand-in for the Anthropic API, for local runs without a key
// (BRIFF_LLM_FAKE=true, refused in production). It derives plausible outputs
// from the request input with keyword rules; nothing it returns is model output.

interface FakeItem {
  ref: number;
  title: string;
  text?: string;
  bucket?: string;
  must_act?: boolean;
  suggested_action?: string | null;
}

function readItems(user: string): FakeItem[] {
  const parsed = JSON.parse(user) as { items?: FakeItem[] };
  return parsed.items ?? [];
}

function fakeBucket(item: FakeItem): string {
  const text = `${item.title} ${item.text ?? ""}`.toLowerCase();
  if (/\b(cve-|ghsa-|vulnerab|security (fix|advisory|patch))/.test(text)) return "security";
  if (/\b(pricing|price|new model|claude (opus|sonnet|haiku)|rate limit)/.test(text))
    return "model_or_pricing";
  if (/\b(breaking|deprecat|major|migrat|introducing|now available|launch)/.test(text))
    return "breaking_or_feature";
  return "minor";
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function fakeOutput(req: JsonRequest<unknown>): unknown {
  if (req.task === "triage") {
    return {
      results: readItems(req.user).map((item) => ({
        ref: item.ref,
        bucket: fakeBucket(item),
        reason: "fake triage (keyword rule)",
        packages: [],
        deadline: null,
      })),
    };
  }
  if (req.task === "synthesis") {
    const items = readItems(req.user);
    const fakeLine = (i: FakeItem) =>
      `[fake LLM] ${(i.text ?? i.title).replace(/\s+/g, " ").slice(0, 180)}`;
    const act = items.filter((i) => i.must_act).slice(0, 5);
    const know = items.filter((i) => !i.must_act && i.bucket !== "minor").slice(0, 5);
    return {
      summary: `[fake LLM] ${act.length} need your attention, ${know.length} good to know.`,
      act: act.map((i) => ({
        ref: i.ref,
        headline: i.title.slice(0, 80),
        line: fakeLine(i),
        action: i.suggested_action ?? "[fake LLM] review the change",
      })),
      know: know.map((i) => ({
        ref: i.ref,
        headline: i.title.slice(0, 80),
        line: fakeLine(i),
        what_to_do: { kind: "read", note: "[fake LLM] read when convenient" },
      })),
    };
  }
  const input = JSON.parse(req.user) as { current_text?: string };
  return { text: input.current_text || "[fake LLM] No interests recorded yet." };
}

/** A Messages API response shape, so the fake goes through the same decoding as the real client. */
function fakeMessage(req: JsonRequest<unknown>): ModelMessage {
  const text = JSON.stringify(fakeOutput(req));
  return {
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: {
      input_tokens: estimateTokens(req.system + req.user),
      output_tokens: estimateTokens(text),
    },
    model: `fake:${req.model}`,
  };
}

/**
 * In-memory Message Batches: ends on the first poll and returns results in reverse
 * order, so callers must map by custom_id. A request whose fake output cannot be
 * built comes back as an `errored` entry, like a per-request API error.
 */
export function fakeBatchTransport(): BatchTransport {
  const batches = new Map<string, { custom_id: string; result: BatchItemResult }[]>();
  return {
    billedAsBatch: false,
    async create(requests) {
      const id = `fakebatch_${batches.size + 1}`;
      batches.set(
        id,
        requests.map(({ custom_id, request }) => {
          try {
            return { custom_id, result: { type: "succeeded", message: fakeMessage(request) } };
          } catch (err) {
            return { custom_id, result: { type: "errored", message: String(err) } };
          }
        })
      );
      return id;
    },
    async status() {
      return "ended";
    },
    async *results(batchId) {
      yield* [...(batches.get(batchId) ?? [])].reverse();
    },
    async cancel(batchId) {
      batches.delete(batchId);
    },
  };
}

export function createFakeLlm(): LlmClient {
  const transport = fakeBatchTransport();
  return {
    kind: "fake",
    async json<T>(req: JsonRequest<T>): Promise<JsonResponse<T>> {
      return decodeMessage(req, fakeMessage(req as JsonRequest<unknown>));
    },
    jsonBatch: (requests, options) =>
      runBatch(transport, requests, { sleep: async () => {}, ...options }),
  };
}
