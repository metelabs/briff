import { alertGroupsOf, type AlertGroupRow, type AlertPackageGroup } from "@/pipeline/alert-groups";
import { computeDrift, type DriftDependency, type DriftRuntimeRow } from "@/pipeline/stack-drift";

import { SAMPLE_BULLETIN } from "./sample-bulletin";

// The landing page's Stack and Alerts samples: the same three fictional repos as the sample
// bulletin, run through the real pure functions the app pages use (computeDrift,
// alertGroupsOf), so the sample cannot show a sentence the product would not write.

const BAKERY = "bakery.example";
const GARDEN = "garden.example";
const ORCHID = "orchid-hotel.example";

const CONNECTION: Record<string, string> = {
  [BAKERY]: "Local scanner",
  [GARDEN]: "GitHub App",
  [ORCHID]: "GitHub App",
};

const RUNTIMES: DriftRuntimeRow[] = [
  {
    repo: BAKERY,
    name: "node",
    version: "22.17.0",
    normalized: "22.17.0",
    source: "Dockerfile",
    image: "node:22.17.0-alpine",
  },
  {
    repo: GARDEN,
    name: "node",
    version: "24.11.0",
    normalized: "24.11.0",
    source: ".nvmrc",
    image: null,
  },
  {
    repo: ORCHID,
    name: "php",
    version: "8.2",
    normalized: "8.2",
    source: "Dockerfile",
    image: "php:8.2-apache",
  },
];

const DEPENDENCIES: DriftDependency[] = [
  { repo: BAKERY, packageName: "next", installedVersion: "15.5.9", latestVersion: "16.3.8" },
  { repo: GARDEN, packageName: "next", installedVersion: "16.3.5", latestVersion: "16.3.8" },
  { repo: BAKERY, packageName: "vite", installedVersion: "7.1.4", latestVersion: "7.2.0" },
  { repo: GARDEN, packageName: "vite", installedVersion: "7.1.9", latestVersion: "7.2.0" },
  { repo: BAKERY, packageName: "axios", installedVersion: "1.12.0", latestVersion: "1.13.2" },
  { repo: GARDEN, packageName: "nodemailer", installedVersion: "7.0.9", latestVersion: "8.0.4" },
  { repo: GARDEN, packageName: "prisma", installedVersion: "7.1.0", latestVersion: "7.1.0" },
  {
    repo: ORCHID,
    ecosystem: "Packagist",
    packageName: "laravel/framework",
    installedVersion: "11.46.1",
    latestVersion: "12.38.0",
  },
];

export interface SampleStackCard {
  id: string;
  connection: string;
  lastScan: string;
}

export function sampleStack() {
  const drift = computeDrift({
    repos: [BAKERY, GARDEN, ORCHID].map((name) => ({ key: name, name })),
    runtimes: RUNTIMES,
    dependencies: DEPENDENCIES,
    asOf: SAMPLE_BULLETIN.createdAt,
  });
  return drift.map((repo) => ({
    ...repo,
    id: repo.key.replace(/\W+/g, "-"),
    connection: CONNECTION[repo.repo] ?? "GitHub App",
    lastScan: "26 Oct 03:30",
  }));
}

function row(
  repo: string,
  pkg: string,
  osvId: string,
  severity: string,
  installed: string,
  fixed: string,
  direct = true
): AlertGroupRow {
  return {
    repo: { name: repo },
    installedVersions: [installed],
    direct,
    advisory: {
      osvId,
      severity,
      summary: null,
      affected: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed }] }],
      fixedVersion: fixed,
      package: { name: pkg },
    },
  };
}

/** The sample bulletin's new advisories as the Alerts page groups them. */
export function sampleAlerts(): AlertPackageGroup[] {
  return alertGroupsOf(
    [
      row(BAKERY, "axios", "GHSA-0000-0000-0001", "HIGH", "1.12.0", "1.13.2"),
      row(GARDEN, "nodemailer", "GHSA-0000-0000-0002", "MODERATE", "7.0.9", "7.0.11"),
      row(BAKERY, "brace-expansion", "GHSA-0000-0000-0003", "LOW", "2.0.1", "2.0.2", false),
      row(GARDEN, "brace-expansion", "GHSA-0000-0000-0003", "LOW", "2.0.1", "2.0.2", false),
    ],
    {
      noLineFix: "no fix on the installed release line",
      fixedIn: "Fixed in",
      transitive: "update the packages that pull it in",
    }
  );
}
