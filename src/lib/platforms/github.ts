import "server-only";

import { z } from "zod";

import type { DiscoveryItem, FetchOptions, PlatformFetcher } from "./types";
import { fetchJson } from "./fetch-with-retry";

export const githubRepoSchema = z.object({
  id: z.number(),
  full_name: z.string(),
  html_url: z.string(),
  description: z.string().nullable().default(null),
  stargazers_count: z.number().default(0),
  forks_count: z.number().default(0),
  language: z.string().nullable().default(null),
  owner: z.object({
    login: z.string(),
  }),
  created_at: z.string(),
  topics: z.array(z.string()).default([]),
});

export const githubSearchResponseSchema = z.object({
  items: z.array(githubRepoSchema),
});

type GithubRepo = z.infer<typeof githubRepoSchema>;

async function searchRepos(query: string, perPage: number): Promise<GithubRepo[]> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `token ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetchJson(
    `github:search:${query}`,
    `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${perPage}`,
    githubSearchResponseSchema,
    { headers, timeoutMs: 6000 }
  );
  return response.items;
}

export const githubFetcher: PlatformFetcher = {
  platform: "github",

  async fetchTrending(options?: FetchOptions): Promise<DiscoveryItem[]> {
    const limit = options?.limit ?? 30;
    const languages = options?.languages ?? [];

    const dateWeekAgo = new Date();
    dateWeekAgo.setDate(dateWeekAgo.getDate() - 7);
    const baseQuery = `created:>${dateWeekAgo.toISOString().split("T")[0]}`;

    // GitHub search has no OR for `language:` (combining multiple AND's to zero).
    // Fan out one query per requested language and merge by stars; dedupe by repo id.
    let repos: GithubRepo[] = [];
    if (languages.length === 0) {
      repos = await searchRepos(baseQuery, limit);
    } else {
      const perLangLimit = Math.max(Math.ceil(limit / languages.length), 10);
      const settled = await Promise.allSettled(
        languages.map((lang) => searchRepos(`${baseQuery} language:${lang}`, perLangLimit))
      );

      const seen = new Set<number>();
      for (const result of settled) {
        if (result.status !== "fulfilled") continue;
        for (const repo of result.value) {
          if (seen.has(repo.id)) continue;
          seen.add(repo.id);
          repos.push(repo);
        }
      }
      repos.sort((a, b) => b.stargazers_count - a.stargazers_count);
      repos = repos.slice(0, limit);
    }

    return repos.map((repo) => ({
      id: `gh-${repo.id}`,
      platform: "github" as const,
      title: repo.full_name,
      url: repo.html_url,
      score: repo.stargazers_count,
      commentCount: 0,
      commentsUrl: null,
      author: repo.owner.login,
      createdAt: repo.created_at,
      tags: repo.topics,
      metadata: {
        language: repo.language ?? undefined,
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        description: repo.description ?? undefined,
      },
    }));
  },
};
