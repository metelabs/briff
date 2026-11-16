import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { fetchWithRetry } from "@/lib/platforms/fetch-with-retry";
import { USER_AGENT } from "@/lib/rss/fetcher";
import {
  GITHUB_ECOSYSTEM,
  isGithubRepoName,
  normalizePickedName,
  type PickableEcosystem,
} from "@/lib/stack-catalog";
import { fetchRegistryPackage } from "@/sources/registries";
import type { Ecosystem } from "@scan/ecosystems";

// The picker's typeahead: names Briff already knows (the Package table) first, then the
// ecosystem's registry for the exact name typed. Tools are checked against the GitHub API.

export type ExactLookup =
  /** The registry (or GitHub) knows it; `name` is its canonical spelling. */
  | { status: "found"; name: string }
  | { status: "not_found" }
  /** The registry could not be asked (rate limit, outage): accepted as typed. */
  | { status: "unverified"; name: string }
  | { status: "invalid" };

export interface PackageSuggestions {
  known: string[];
  exact: ExactLookup;
}

const SUGGESTIONS = 8;

export async function suggestPackages(
  db: PrismaClient,
  ecosystem: PickableEcosystem,
  query: string
): Promise<PackageSuggestions> {
  const name = normalizePickedName(ecosystem, query);
  const prefix = query.trim();
  const known =
    prefix.length < 2
      ? []
      : (
          await db.package.findMany({
            where: {
              ecosystem,
              name: { startsWith: prefix, mode: "insensitive" },
              // Only names a public registry confirmed (refresh-packages stored a latest
              // version): never another org's private package, never who depends on what.
              latestVersion: { not: null },
            },
            select: { name: true },
            orderBy: { name: "asc" },
            take: SUGGESTIONS,
          })
        ).map((p) => p.name);
  if (!name) return { known, exact: { status: "invalid" } };
  if (known.includes(name)) return { known, exact: { status: "found", name } };
  const exact =
    ecosystem === GITHUB_ECOSYSTEM
      ? await checkGithubRepo(name)
      : await registryLookup(ecosystem, name);
  return { known, exact };
}

async function registryLookup(ecosystem: Ecosystem, name: string): Promise<ExactLookup> {
  try {
    const res = await fetchRegistryPackage(ecosystem, name);
    return res.status === "ok" ? { status: "found", name } : { status: "not_found" };
  } catch (err) {
    log.warn({ err, ecosystem, name }, "stack: registry lookup failed; accepted as typed");
    return { status: "unverified", name };
  }
}

/**
 * Whether a public GitHub repository exists, with its canonical `owner/repo`. Without a token
 * the API allows 60 requests an hour per IP; when it refuses, the name is accepted unverified.
 */
export async function checkGithubRepo(raw: string): Promise<ExactLookup> {
  const name = raw.trim();
  if (!isGithubRepoName(name)) return { status: "invalid" };
  const token = getEnv().GITHUB_TOKEN;
  try {
    const res = await fetchWithRetry(`https://api.github.com/repos/${name}`, {
      timeoutMs: 8000,
      retries: 1,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": USER_AGENT,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (res.status === 404) return { status: "not_found" };
    if (!res.ok) return { status: "unverified", name };
    const body = (await res.json()) as { full_name?: unknown; private?: unknown };
    if (body.private === true) return { status: "not_found" };
    const canonical = typeof body.full_name === "string" ? body.full_name : name;
    return isGithubRepoName(canonical)
      ? { status: "found", name: canonical }
      : { status: "found", name };
  } catch (err) {
    log.warn({ err, name }, "stack: GitHub lookup failed; accepted unverified");
    return { status: "unverified", name };
  }
}
