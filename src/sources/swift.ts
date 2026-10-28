import semver from "semver";
import { z } from "zod";
import { fetchWithRetry } from "@/lib/platforms/fetch-with-retry";
import { swiftPackageName } from "@scan/swift-url";
import { parseGithubRepo, githubRepoUrl } from "./github-releases";
import type { RegistryLookup } from "./registries";
const releasesSchema = z.array(
  z.object({ tag_name: z.string(), draft: z.boolean(), prerelease: z.boolean() })
);

export async function fetchSwiftPackage(name: string): Promise<RegistryLookup> {
  const canonical = swiftPackageName(name);
  if (!canonical) return { status: "not_found" };
  const url = `https://${canonical}`;
  const repo = parseGithubRepo(url);
  const repositoryUrl = repo ? githubRepoUrl(repo) : url;
  let latestVersion: string | null = null;
  if (repo) {
    const res = await fetchWithRetry(
      `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases?per_page=100`,
      { headers: { Accept: "application/vnd.github+json" }, timeoutMs: 10_000, retries: 2 }
    );
    if (res.status !== 404) {
      if (!res.ok) throw new Error(`swift:${name}: HTTP ${res.status}`);
      latestVersion =
        releasesSchema
          .parse(await res.json())
          .flatMap((release) => {
            const version = semver.valid(release.tag_name);
            return version && !release.draft && !release.prerelease && !semver.prerelease(version)
              ? [version]
              : [];
          })
          .sort(semver.rcompare)[0] ?? null;
    }
  }
  return {
    status: "ok",
    info: { latestVersion, deprecated: null, repositoryUrl, homepage: repositoryUrl },
  };
}
