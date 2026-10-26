import semver from "semver";
import { z } from "zod";

import { fetchWithRetry } from "@/lib/platforms/fetch-with-retry";

import type { RegistryLookup } from "./registries";

export const actionTagsSchema = z.array(
  z.object({
    name: z.string(),
    commit: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/i) }),
  })
);

/** Keep only immutable release tags; floating major tags are not installed versions. */
export function actionTags(value: unknown): Record<string, string> {
  return Object.fromEntries(
    actionTagsSchema.parse(value).flatMap((tag) => {
      const version = semver.valid(tag.name);
      return version && !semver.prerelease(version) ? [[tag.name, tag.commit.sha]] : [];
    })
  );
}

export function storedActionTags(value: unknown): Record<string, string> | undefined {
  const parsed = z.record(z.string(), z.string().regex(/^[a-f0-9]{40}$/i)).safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export async function fetchAction(name: string): Promise<RegistryLookup> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(name)) return { status: "not_found" };
  const res = await fetchWithRetry(`https://api.github.com/repos/${name}/tags?per_page=100`, {
    headers: { Accept: "application/vnd.github+json" },
    timeoutMs: 15_000,
  });
  if (res.status === 404) return { status: "not_found" };
  if (!res.ok) throw new Error(`action:${name}: HTTP ${res.status}`);
  const tags = actionTags(await res.json());
  const latestVersion = Object.keys(tags)
    .flatMap((tag) => semver.valid(tag) ?? [])
    .sort(semver.rcompare)[0];
  if (!latestVersion) return { status: "not_found" };
  return {
    status: "ok",
    info: {
      latestVersion,
      deprecated: null,
      repositoryUrl: `https://github.com/${name}`,
      homepage: `https://github.com/${name}`,
      actionTags: tags,
    },
  };
}
