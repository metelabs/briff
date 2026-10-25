import "server-only";

import { z } from "zod";

import type { DiscoveryItem, FetchOptions, PlatformFetcher } from "./types";
import { fetchJson } from "./fetch-with-retry";
import { getOAuthToken } from "./oauth";
import { log } from "@/lib/log";

const PH_QUERY = /* GraphQL */ `
  query Trending($first: Int!) {
    posts(first: $first, order: VOTES) {
      edges {
        node {
          id
          name
          tagline
          url
          votesCount
          commentsCount
          createdAt
          user {
            username
          }
          topics(first: 3) {
            edges {
              node {
                name
              }
            }
          }
          thumbnail {
            url
          }
        }
      }
    }
  }
`;

export const phNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  tagline: z.string().default(""),
  url: z.string(),
  votesCount: z.number().default(0),
  commentsCount: z.number().default(0),
  createdAt: z.string(),
  user: z
    .object({
      username: z.string(),
    })
    .nullable()
    .default(null),
  topics: z
    .object({
      edges: z.array(
        z.object({
          node: z.object({
            name: z.string(),
          }),
        })
      ),
    })
    .default({ edges: [] }),
  thumbnail: z
    .object({
      url: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export const phResponseSchema = z.object({
  data: z.object({
    posts: z.object({
      edges: z.array(
        z.object({
          node: phNodeSchema,
        })
      ),
    }),
  }),
});

const PH_TOKEN_URL = "https://api.producthunt.com/v2/oauth/token";
const PH_GRAPHQL_URL = "https://api.producthunt.com/v2/api/graphql";

async function getProductHuntToken(): Promise<string | null> {
  const clientId = process.env.PRODUCTHUNT_API_KEY;
  const clientSecret = process.env.PRODUCTHUNT_API_SECRET;
  if (!clientId || !clientSecret) return null;

  return getOAuthToken({
    provider: "producthunt",
    clientId,
    clientSecret,
    tokenUrl: PH_TOKEN_URL,
    authStyle: "body",
    bodyStyle: "json",
    // PH's token endpoint doesn't return `expires_in`; their tokens are
    // long-lived in practice. Cache for 12h to stay safely under any
    // server-side rotation window we can't observe.
    fallbackTtlSeconds: 43_200,
  });
}

export const producthuntFetcher: PlatformFetcher = {
  platform: "producthunt",

  async fetchTrending(options?: FetchOptions): Promise<DiscoveryItem[]> {
    const limit = options?.limit ?? 20;

    // The old unofficial frontend GraphQL endpoint is behind Cloudflare now and
    // serves a challenge page to scripts. We use the official OAuth-protected
    // API instead — requires PRODUCTHUNT_API_KEY + PRODUCTHUNT_API_SECRET
    // (register an app at https://www.producthunt.com/v2/oauth/applications).
    // No creds → return [] so the feed renders with the other platforms.
    const token = await getProductHuntToken();
    if (!token) {
      log.warn(
        {},
        "producthunt: PRODUCTHUNT_API_KEY/SECRET not set, skipping (official API requires OAuth)"
      );
      return [];
    }

    let parsed;
    try {
      parsed = await fetchJson("producthunt:trending", PH_GRAPHQL_URL, phResponseSchema, {
        method: "POST",
        timeoutMs: 6000,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          query: PH_QUERY,
          variables: { first: limit },
        }),
      });
    } catch (err) {
      log.warn({ err }, "producthunt: fetch/parse failed, skipping");
      return [];
    }

    return parsed.data.posts.edges.map((edge) => ({
      id: `ph-${edge.node.id}`,
      platform: "producthunt" as const,
      title: edge.node.name,
      url: edge.node.url,
      score: edge.node.votesCount,
      commentCount: edge.node.commentsCount,
      commentsUrl: edge.node.url,
      author: edge.node.user?.username ?? null,
      createdAt: edge.node.createdAt,
      tags: edge.node.topics.edges.map((t) => t.node.name.toLowerCase()),
      metadata: {
        tagline: edge.node.tagline,
        votesCount: edge.node.votesCount,
        thumbnail: edge.node.thumbnail?.url ?? undefined,
      },
    }));
  },
};
