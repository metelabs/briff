import semver from "semver";
import { z } from "zod";
import { fetchWithRetry } from "@/lib/platforms/fetch-with-retry";
import { parseGithubRepo } from "./github-releases";
import type { RegistryLookup } from "./registries";

const schema = z.object({
  meta: z.object({ links: z.record(z.string(), z.string()).default({}) }),
  releases: z.array(z.object({ version: z.string() })),
  retirements: z
    .record(z.string(), z.object({ reason: z.string(), message: z.string().nullish() }))
    .default({}),
});

export async function fetchHexPackage(name: string): Promise<RegistryLookup> {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) return { status: "not_found" };
  const res = await fetchWithRetry(`https://hex.pm/api/packages/${name}`, {
    headers: { Accept: "application/json" },
    timeoutMs: 10_000,
    retries: 2,
  });
  if (res.status === 404) return { status: "not_found" };
  if (!res.ok) throw new Error(`hex:${name}: HTTP ${res.status}`);
  const body = schema.parse(await res.json());
  const releases = body.releases.filter(
    (release) => semver.valid(release.version) && !semver.prerelease(release.version)
  );
  const latest = releases
    .filter((release) => !body.retirements[release.version])
    .sort((a, b) => semver.rcompare(a.version, b.version))[0];
  const links = Object.values(body.meta.links);
  const repositoryUrl =
    links.find((link) => parseGithubRepo(link)) ??
    body.meta.links.Repository ??
    body.meta.links.Source ??
    null;
  return {
    status: "ok",
    info: {
      latestVersion: latest?.version ?? null,
      deprecated:
        releases.length > 0 && releases.every((release) => body.retirements[release.version])
          ? "All stable releases are retired."
          : null,
      repositoryUrl,
      homepage: body.meta.links.Website ?? body.meta.links.Homepage ?? null,
    },
  };
}
