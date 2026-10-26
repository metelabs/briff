import { z } from "zod";

import { fetchWithRetry } from "@/lib/platforms/fetch-with-retry";

import type { RegistryInfo, RegistryLookup } from "./registries";

export const rubyGemsSchema = z.object({
  version: z.string(),
  source_code_uri: z.string().nullish(),
  homepage_uri: z.string().nullish(),
  metadata: z.object({ source_code_uri: z.string().optional() }).nullish(),
});

export function toRubyGemsInfo(
  body: z.infer<typeof rubyGemsSchema>,
  version: string
): RegistryInfo {
  return {
    latestVersion: version,
    deprecated: null,
    repositoryUrl:
      body.source_code_uri || body.metadata?.source_code_uri || body.homepage_uri || null,
    homepage: body.homepage_uri ?? null,
  };
}

/** The latest endpoint excludes yanked versions; RubyGems has no deprecation field. */
export async function fetchRubyGemsPackage(name: string): Promise<RegistryLookup> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) return { status: "not_found" };
  const read = async (path: string) =>
    fetchWithRetry(`https://rubygems.org/api/v1/${path}`, {
      headers: { Accept: "application/json" },
      timeoutMs: 10_000,
      retries: 2,
    });
  const metadata = await read(`gems/${name}.json`);
  if (metadata.status === 404) return { status: "not_found" };
  if (!metadata.ok) throw new Error(`rubygems:${name}: HTTP ${metadata.status}`);
  const body = rubyGemsSchema.parse(await metadata.json());
  const latest = await read(`versions/${name}/latest.json`);
  if (!latest.ok) throw new Error(`rubygems:${name}: HTTP ${latest.status}`);
  const { version } = z.object({ version: z.string() }).parse(await latest.json());
  return { status: "ok", info: toRubyGemsInfo(body, version) };
}
