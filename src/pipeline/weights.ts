// Interest weights (plan §7.8). Keys name what an item is about:
// `package:<name>`, `service:<key>`, `source:<feed name>`, `topic:<bucket>`.
// Feedback moves them; the bulletin ranks with them; the profile text explains them.

export type FeedbackKind = "up" | "down" | "less";
export type Weights = Record<string, number>;

export const WEIGHT_LIMIT = 5;
/** Items whose keys add up to this or lower are left out of the bulletin. */
export const EXCLUDE_AT = -3;

export interface ItemKeys {
  packages: string[];
  services: string[];
  source: string | null;
  topic: string | null;
}

export function weightKeys(keys: ItemKeys): { specific: string[]; broad: string[] } {
  return {
    specific: [
      ...keys.packages.map((p) => `package:${p}`),
      ...keys.services.map((s) => `service:${s}`),
    ],
    broad: [
      ...(keys.source ? [`source:${keys.source}`] : []),
      ...(keys.topic ? [`topic:${keys.topic}`] : []),
    ],
  };
}

/**
 * Per-key change for one feedback. 👍 raises everything the item is about; 👎
 * mostly blames the specific package/service; "less of this" turns down the
 * whole kind of item, including its source and topic.
 */
export function feedbackDeltas(kind: FeedbackKind, keys: ItemKeys): Weights {
  const { specific, broad } = weightKeys(keys);
  const deltas: Weights = {};
  const add = (list: string[], value: number) => {
    for (const key of list) deltas[key] = (deltas[key] ?? 0) + value;
  };
  if (kind === "up") {
    add(specific, 1);
    add(broad, 0.5);
  } else if (kind === "down") {
    add(specific, -1);
    add(broad, -0.5);
  } else {
    add(specific, -1);
    add(broad, -1);
  }
  return deltas;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Replaces a previous feedback (or none) with a new one (or none); clamps and drops zeros. */
export function applyFeedbackChange(
  weights: Weights,
  keys: ItemKeys,
  previous: FeedbackKind | null,
  next: FeedbackKind | null
): Weights {
  const out: Weights = { ...weights };
  const shift = (deltas: Weights, sign: 1 | -1) => {
    for (const [key, delta] of Object.entries(deltas)) out[key] = (out[key] ?? 0) + sign * delta;
  };
  if (previous) shift(feedbackDeltas(previous, keys), -1);
  if (next) shift(feedbackDeltas(next, keys), 1);
  for (const key of Object.keys(out)) {
    const value = round(Math.max(-WEIGHT_LIMIT, Math.min(WEIGHT_LIMIT, out[key])));
    if (value === 0) delete out[key];
    else out[key] = value;
  }
  return out;
}

export function parseWeights(value: unknown): Weights {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Weights = {};
  for (const [key, v] of Object.entries(value))
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
  return out;
}

/** Sum of the weights that apply to an item. */
export function itemWeight(weights: Weights, keys: ItemKeys): number {
  const { specific, broad } = weightKeys(keys);
  return [...specific, ...broad].reduce((sum, key) => sum + (weights[key] ?? 0), 0);
}
