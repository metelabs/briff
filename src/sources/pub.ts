import { z } from "zod";
import { fetchWithRetry } from "@/lib/platforms/fetch-with-retry";
import type { RegistryLookup } from "./registries";

const release = z.object({
  version: z.string(),
  retracted: z.boolean().optional(),
  pubspec: z.object({ repository: z.string().optional(), homepage: z.string().optional() }),
});
const schema = z.object({
  isDiscontinued: z.boolean().optional(),
  latest: release,
  versions: z.array(release).optional(),
});

export async function fetchPubPackage(name: string): Promise<RegistryLookup> {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) return { status: "not_found" };
  const res = await fetchWithRetry(`https://pub.dev/api/packages/${name}`, {
    headers: { Accept: "application/vnd.pub.v2+json" },
    timeoutMs: 10_000,
    retries: 2,
  });
  if (res.status === 404) return { status: "not_found" };
  if (!res.ok) throw new Error(`pub:${name}: HTTP ${res.status}`);
  const body = schema.parse(await res.json());
  const current = body.latest;
  return {
    status: "ok",
    info: {
      latestVersion: current.retracted ? null : current.version,
      deprecated: body.isDiscontinued ? "This package is discontinued." : null,
      repositoryUrl: current.pubspec.repository ?? current.pubspec.homepage ?? null,
      homepage: current.pubspec.homepage ?? null,
    },
  };
}
