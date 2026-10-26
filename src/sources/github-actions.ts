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

export class ActionVisibilityDeferred extends Error {
  constructor(readonly retryAt: Date) {
    super("GitHub Actions visibility checks deferred until the rate limit resets");
  }
}

/** No credentials: private repositories must never reach the public advisory service. */
export async function isPublicAction(name: string): Promise<boolean> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(name)) return false;
  const res = await fetchWithRetry(`https://api.github.com/repos/${name}`, {
    retries: 0,
    headers: { Accept: "application/vnd.github+json" },
    timeoutMs: 15_000,
  });
  if (
    res.status === 429 ||
    (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")
  ) {
    const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
    const after = Number(res.headers.get("retry-after")) * 1000;
    throw new ActionVisibilityDeferred(
      new Date(Math.max(Date.now() + 1000, reset || Date.now() + (after || 3_600_000)))
    );
  }
  if (res.status >= 500) throw new Error(`GitHub Actions visibility: HTTP ${res.status}`);
  if (!res.ok) return false;
  const parsed = z.object({ private: z.boolean() }).safeParse(await res.json());
  return parsed.success && parsed.data.private === false;
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
