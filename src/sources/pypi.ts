import { z } from "zod";

import { fetchWithRetry } from "@/lib/platforms/fetch-with-retry";
import { normalizeVersion } from "@scan/ecosystems";

import { parseGithubRepo } from "./github-releases";
import type { RegistryInfo } from "./registries";

// PyPI JSON API (`/pypi/<name>/json`): `info.version` is the newest non-prerelease, non-yanked
// release; `info.project_urls` names the repository under a key the project picks.

const PYPI = "https://pypi.org/pypi";

// PEP 503-normalised names, which is how Briff stores them (letters, digits, single `-`).
const NAME_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export const pypiResponseSchema = z
  .object({
    info: z
      .object({
        version: z.string(),
        home_page: z.string().nullish(),
        project_urls: z.record(z.string(), z.string().nullable()).nullish(),
        classifiers: z.array(z.string()).nullish(),
        yanked: z.boolean().nullish(),
        yanked_reason: z.string().nullish(),
      })
      .loose(),
  })
  .loose();

export function pypiUrl(name: string): string | null {
  return NAME_RE.test(name) ? `${PYPI}/${name}/json` : null;
}

// Keys projects use for their code host, most specific first (case-insensitive).
const REPO_KEYS = ["source", "source code", "repository", "code", "github", "homepage"];

const INACTIVE = "Development Status :: 7 - Inactive";

export function toPypiInfo(body: z.infer<typeof pypiResponseSchema>): RegistryInfo {
  const { info } = body;
  const urls = Object.entries(info.project_urls ?? {}).flatMap(([key, value]) =>
    value ? [{ key: key.toLowerCase(), value }] : []
  );
  const candidates = [
    ...REPO_KEYS.flatMap((k) => urls.filter((u) => u.key === k).map((u) => u.value)),
    ...urls.map((u) => u.value),
    ...(info.home_page ? [info.home_page] : []),
  ];
  const repositoryUrl =
    candidates.find((u) => parseGithubRepo(u) !== null) ??
    REPO_KEYS.slice(0, 5)
      .flatMap((k) => urls.filter((u) => u.key === k).map((u) => u.value))
      .at(0) ??
    null;
  const homepage = urls.find((u) => u.key === "homepage")?.value ?? info.home_page ?? null;
  return {
    latestVersion: normalizeVersion("PyPI", info.version),
    deprecated: (info.classifiers ?? []).includes(INACTIVE)
      ? "Marked inactive on PyPI (Development Status :: 7 - Inactive)."
      : null,
    repositoryUrl,
    homepage: homepage || null,
  };
}

export type PypiLookup = { status: "ok"; info: RegistryInfo } | { status: "not_found" };

/** Newest release, inactive status and repository; `not_found` for private or unknown names. */
export async function fetchPypiPackage(name: string): Promise<PypiLookup> {
  const url = pypiUrl(name);
  if (!url) return { status: "not_found" };
  const res = await fetchWithRetry(url, {
    headers: { Accept: "application/json" },
    timeoutMs: 10_000,
    retries: 2,
  });
  if (res.status === 404) return { status: "not_found" };
  if (!res.ok) throw new Error(`pypi:${name}: HTTP ${res.status}`);
  const parsed = pypiResponseSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error(`pypi:${name}: invalid metadata`);
  return { status: "ok", info: toPypiInfo(parsed.data) };
}
