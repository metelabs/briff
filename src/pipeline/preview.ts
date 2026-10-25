import { withOrg } from "@/lib/db/with-org";
import { PRODUCT_LANGUAGE } from "@/lib/i18n";
import { getLlm, TokenMeter } from "@/llm/client";
import { loadPrompt } from "@/llm/prompts";
import type { JobContext, JobResult } from "@/worker/types";

import { isoWeekLabel, weekStartOf } from "./bulletin";
import { previewPayloadSchema } from "./preview-payload";
import { prepareStream, storeBulletin, synthesisRequest, type SynthesisContext } from "./weekly";

// bulletin-preview: the weekly synthesis for one stream and the current week with a
// chosen model, stored as a preview bulletin (Bulletin.preview) to compare models
// side by side. Never emailed, never the week's bulletin, never touches its input hash.

export async function bulletinPreview({ db, log, payload }: JobContext): Promise<JobResult> {
  const counts = {
    generated: 0,
    empty: 0,
    invalidPayload: 0,
    llmUnavailable: 0,
    inputChars: 0,
    refMismatch: 0,
  };
  const parsed = previewPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    // A retry cannot fix the payload; record it instead of failing the job.
    counts.invalidPayload = 1;
    log.warn({ issues: parsed.error.issues }, "preview: invalid payload");
    return { counts };
  }
  const { orgId, streamId, model } = parsed.data;
  const llm = getLlm();
  if (!llm.ok) {
    counts.llmUnavailable = 1;
    log.warn({ reason: llm.reason }, "preview: LLM unavailable, skipping");
    return { counts };
  }

  const stream = await withOrg(db, orgId).bulletinStream.findFirst({
    where: { id: streamId },
    select: { id: true, name: true, repos: { select: { repoId: true } } },
  });
  if (!stream) throw new Error(`stream ${streamId} not found in org ${orgId}`);

  const prompt = loadPrompt("synthesis");
  const now = new Date();
  const ctx: SynthesisContext = {
    now,
    weekStart: weekStartOf(now),
    week: isoWeekLabel(now),
    language: PRODUCT_LANGUAGE,
    model,
    promptVersion: prompt.version,
  };
  const prepared = await prepareStream(
    db,
    orgId,
    { id: stream.id, name: stream.name, repoIds: stream.repos.map((r) => r.repoId) },
    ctx
  );
  if (!prepared) {
    counts.empty = 1;
    log.info({ orgId, streamId }, "preview: nothing to report");
    return { counts };
  }
  counts.inputChars = prepared.inputChars;

  // One request someone is waiting for: the direct call, not a Message Batch.
  const res = await llm.client.json(synthesisRequest(prepared, model, prompt.text));
  const meter = new TokenMeter();
  meter.add("synthesis", res.model, res.usage);
  const stored = await storeBulletin(db, prepared, res, ctx, { kind: "preview", model }, log);
  counts.generated = 1;
  counts.refMismatch = stored.refMismatch;
  log.info({ orgId, streamId, model, bulletinId: stored.bulletinId }, "preview: stored");
  return { counts, tokens: meter.toJSON() };
}
