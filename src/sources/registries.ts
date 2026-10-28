import { fetchPubPackage } from "./pub";
import type { Ecosystem } from "@scan/ecosystems";
import { fetchNugetPackage } from "./nuget";
import { fetchMavenPackage } from "./maven";
import { fetchCrate } from "./crates";

import { fetchAction } from "./github-actions";

import { fetchRubyGemsPackage } from "./rubygems";
import { fetchGoModule } from "./go-proxy";
import { fetchNpmPackage, type NpmPackageInfo } from "./npm-registry";
import { fetchPackagistPackage } from "./packagist";
import { fetchPypiPackage } from "./pypi";

// One lookup per ecosystem's registry, all with the same answer shape, so refresh-packages
// treats every package alike (latest version, deprecation, repository link). Each adapter
// talks to one fixed host through fetchWithRetry (timeout, backoff on 429/5xx).

export type RegistryInfo = Omit<NpmPackageInfo, "latestVersion"> & { latestVersion: string | null };

export type RegistryLookup = { status: "ok"; info: RegistryInfo } | { status: "not_found" };

export function fetchRegistryPackage(ecosystem: Ecosystem, name: string): Promise<RegistryLookup> {
  switch (ecosystem) {
    case "Pub":
      return fetchPubPackage(name);
    case "NuGet":
      return fetchNugetPackage(name);
    case "Maven":
      return fetchMavenPackage(name);
    case "GitHub Actions":
      return fetchAction(name);

    case "crates.io":
      return fetchCrate(name);

    case "RubyGems":
      return fetchRubyGemsPackage(name);
    case "npm":
      return fetchNpmPackage(name);
    case "Packagist":
      return fetchPackagistPackage(name);
    case "PyPI":
      return fetchPypiPackage(name);
    case "Go":
      return fetchGoModule(name);
  }
}
