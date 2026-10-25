import { z } from "zod";

// Shared by the admin action (enqueue) and the bulletin-preview job; no server imports.

export const PREVIEW_MODELS = ["claude-sonnet-5-5", "claude-haiku-5-5"] as const;
export type PreviewModel = (typeof PREVIEW_MODELS)[number];

export const previewPayloadSchema = z.object({
  orgId: z.string().min(1),
  streamId: z.string().min(1),
  model: z.enum(PREVIEW_MODELS),
});

export type PreviewPayload = z.infer<typeof previewPayloadSchema>;

export const previewDedupeKey = (p: PreviewPayload) => `bulletin-preview:${p.streamId}:${p.model}`;
