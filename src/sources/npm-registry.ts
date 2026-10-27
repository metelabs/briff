import { z } from "zod";

import { fetchWithRetry } from "@/lib/platforms/fetch-with-retry";

const REGISTRY = "https://registry.npmjs.org";

const repositorySchema = z.union([
  z.string(),
  z.object({ url: z.string().optional(), directory: z.string().optional() }).loose(),
]);

export const npmLatestSchema = z
  .object({
    name: z.string(),
    version: z.string(),
    // npm sets `deprecated` to the deprecation message (a string); some old
    // manifests carry `false`.
    deprecated: z.union([z.string(), z.boolean()]).optional(),
    homepage: z.string().optional(),
    repository: repositorySchema.optional(),
  })
  .loose();

export interface NpmPackageInfo {
  actionTags?: Record<string, string>;
  latestVersion: string;
  deprecated: string | null;
  repositoryUrl: string | null;
  homepage: string | null;
}

export function npmLatestUrl(name: string): string {
  // Scoped names keep the "@" but escape the slash.
  return `${REGISTRY}/${name.replace("/", "%2F")}/latest`;
}

export function toPackageInfo(manifest: z.infer<typeof npmLatestSchema>): NpmPackageInfo {
  const repo = manifest.repository;
  const repositoryUrl = typeof repo === "string" ? repo : (repo?.url ?? null);
  return {
    latestVersion: manifest.version,
    deprecated:
      typeof manifest.deprecated === "string" && manifest.deprecated ? manifest.deprecated : null,
    repositoryUrl,
    homepage: manifest.homepage ?? null,
  };
}

export type NpmLookup = { status: "ok"; info: NpmPackageInfo } | { status: "not_found" };

/** Latest published manifest; `not_found` for private, unpublished or workspace-only names. */
export async function fetchNpmPackage(name: string): Promise<NpmLookup> {
  const res = await fetchWithRetry(npmLatestUrl(name), {
    headers: { Accept: "application/json" },
    timeoutMs: 10_000,
    retries: 2,
  });
  if (res.status === 404) return { status: "not_found" };
  if (!res.ok) throw new Error(`npm:${name}: HTTP ${res.status}`);
  const parsed = npmLatestSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error(`npm:${name}: invalid manifest`);
  return { status: "ok", info: toPackageInfo(parsed.data) };
}
