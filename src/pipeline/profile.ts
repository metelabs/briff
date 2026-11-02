import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import type { Logger } from "@/lib/log";
import type { JsonRequest, LlmClient, TokenMeter } from "@/llm/client";
import type { LlmUsageRecord } from "@/lib/usage";
import { repoAliases } from "@/llm/pseudonym";
import { loadPrompt } from "@/llm/prompts";

import { parseWeights, type Weights } from "./weights";

// refresh-profile step (plan §7.8): before the weekly synthesis, Haiku rewrites
// the profile text from the weights and the feedback since the last refresh.

const PROFILE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: { text: { type: "string" } },
} as const;

const profileOutputSchema = z.object({ text: z.string() });

const MAX_FEEDBACK = 50;

/**
 * The profile text is written by or for the developer and may name their repos: those
 * leave as aliases (`repo-1`) and come back as names in the rewritten text.
 */
export function profileRequest(args: {
  model: string;
  system: string;
  language: string;
  currentText: string;
  weights: Weights;
  feedback: { kind: string; title: string }[];
  repoNames: string[];
  /** Package names the org installs: public, never rewritten in the text. */
  packageNames: string[];
  privateActionNames?: string[];
}): JsonRequest<{ text: string }> {
  const aliases = repoAliases(
    args.repoNames,
    [...args.packageNames, ...weightNames(args.weights)],
    {
      privateNames: args.privateActionNames,
    }
  );
  return {
    task: "profile",
    model: args.model,
    system: args.system,
    user: JSON.stringify({
      language: args.language,
      current_text: aliases.aliasText(args.currentText),
      weights: Object.fromEntries(
        Object.entries(args.weights).map(([key, value]) => [aliases.aliasText(key), value])
      ),
      recent_feedback: args.feedback.map((f) => ({ ...f, title: aliases.aliasText(f.title) })),
    }),
    schema: PROFILE_JSON_SCHEMA,
    parse: (v) => {
      const out = profileOutputSchema.parse(v);
      return { text: aliases.restoreText(out.text) };
    },
    maxTokens: 4000,
    effort: "low",
  };
}

/** `package:next` -> `next`: names in the weights are public and never aliased in text. */
function weightNames(weights: Weights): string[] {
  return Object.keys(weights).map((k) => k.slice(k.indexOf(":") + 1));
}

export async function refreshProfile(args: {
  db: PrismaClient;
  llm: LlmClient;
  model: string;
  orgId: string;
  language: string;
  meter: TokenMeter;
  log: Logger;
  /** Per-org usage rollup (OrgUsage); the meter is the run's total. */
  onUsage?: (record: LlmUsageRecord) => Promise<void>;
}): Promise<"refreshed" | "unchanged"> {
  const scoped = withOrg(args.db, args.orgId);
  const profile = await scoped.interestProfile.findFirst();
  const since = profile?.refreshedAt ?? null;
  const feedback = await scoped.feedback.findMany({
    where: since ? { createdAt: { gt: since } } : {},
    orderBy: { createdAt: "desc" },
    take: MAX_FEEDBACK,
    select: { kind: true, item: { select: { title: true } }, itemId: true },
  });
  if (feedback.length === 0) return "unchanged";

  const prompt = loadPrompt("profile");
  const res = await args.llm.json(
    profileRequest({
      model: args.model,
      system: prompt.text,
      language: args.language,
      currentText: profile?.text ?? "",
      weights: parseWeights(profile?.weights),
      feedback: feedback.map((f) => ({ kind: f.kind, title: f.item.title })),
      repoNames: (await scoped.repo.findMany({ select: { name: true } })).map((r) => r.name),
      privateActionNames: (
        await scoped.dependency.findMany({
          where: { package: { ecosystem: "GitHub Actions" } },
          distinct: ["packageId"],
          select: { package: { select: { name: true } } },
        })
      ).map((d) => d.package.name),
      packageNames: (
        await scoped.dependency.findMany({
          distinct: ["packageId"],
          select: { package: { select: { name: true } } },
        })
      ).map((d) => d.package.name),
    })
  );
  args.meter.add("profile", res.model, res.usage);
  await args.onUsage?.({ task: "profile", model: res.model, usage: res.usage, batch: false });
  const text = res.data.text.trim().slice(0, 2000);
  const data = { text, refreshedAt: new Date(), model: res.model, promptVersion: prompt.version };
  if (profile) await scoped.interestProfile.update({ where: { id: profile.id }, data });
  else await scoped.interestProfile.create({ data: { orgId: args.orgId, ...data } });
  args.log.info({ orgId: args.orgId, feedback: feedback.length }, "profile: refreshed");
  return "refreshed";
}
