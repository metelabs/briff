import { z } from "zod";
import { fetchWithRetry } from "@/lib/platforms/fetch-with-retry";
import type { RegistryLookup } from "./registries";

export const cratesSchema = z.object({
  crate: z.object({
    max_stable_version: z.string().nullable(),
    repository: z.string().nullish(),
    homepage: z.string().nullish(),
  }),
  versions: z.array(z.object({ num: z.string(), yanked: z.boolean() })),
});

export async function fetchCrate(name: string): Promise<RegistryLookup> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) return { status: "not_found" };
  const res = await fetchWithRetry(`https://crates.io/api/v1/crates/${name}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Briff/1.0 (+https://github.com/metelabs/briff)",
    },
    timeoutMs: 10_000,
    retries: 2,
  });
  if (res.status === 404) return { status: "not_found" };
  if (!res.ok) throw new Error(`crates.io:${name}: HTTP ${res.status}`);
  const body = cratesSchema.parse(await res.json());
  const version = body.crate.max_stable_version;
  const latest = body.versions.find((v) => v.num === version);
  return {
    status: "ok",
    info: {
      latestVersion: latest && !latest.yanked ? version : null,
      deprecated:
        body.versions.length > 0 && body.versions.every((v) => v.yanked)
          ? "All releases are yanked."
          : null,
      repositoryUrl: body.crate.repository ?? null,
      homepage: body.crate.homepage ?? null,
    },
  };
}
