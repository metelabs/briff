import type { Ecosystem } from "@scan/ecosystems";

import { fetchAction } from "./github-actions";

import { fetchGoModule } from "./go-proxy";
import { fetchNpmPackage, type NpmPackageInfo } from "./npm-registry";
import { fetchPackagistPackage } from "./packagist";
import { fetchPypiPackage } from "./pypi";

// One lookup per ecosystem's registry, all with the same answer shape, so refresh-packages
// treats every package alike (latest version, deprecation, repository link). Each adapter
// talks to one fixed host through fetchWithRetry (timeout, backoff on 429/5xx).

export type RegistryInfo = NpmPackageInfo;

export type RegistryLookup = { status: "ok"; info: RegistryInfo } | { status: "not_found" };

export function fetchRegistryPackage(ecosystem: Ecosystem, name: string): Promise<RegistryLookup> {
  switch (ecosystem) {
    case "GitHub Actions":
      return fetchAction(name);
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
