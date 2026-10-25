import { z } from "zod";

import type { DiscoveryItem, FetchOptions, PlatformFetcher } from "./types";
import { fetchJson } from "./fetch-with-retry";

const HN_API = "https://hacker-news.firebaseio.com/v0";
const HN_ITEM_TIMEOUT_MS = 3000;

export const hnItemSchema = z.object({
  id: z.number(),
  title: z.string(),
  url: z.string().optional(),
  score: z.number().default(0),
  by: z.string().default("unknown"),
  time: z.number(),
  descendants: z.number().default(0),
  type: z.string(),
});

export const hnTopStoriesSchema = z.array(z.number());

type HNItem = z.infer<typeof hnItemSchema>;

async function fetchItem(id: number): Promise<HNItem | null> {
  try {
    return await fetchJson(`hn:item:${id}`, `${HN_API}/item/${id}.json`, hnItemSchema, {
      timeoutMs: HN_ITEM_TIMEOUT_MS,
      retries: 1,
    });
  } catch {
    return null;
  }
}

export const hackernewsFetcher: PlatformFetcher = {
  platform: "hackernews",

  async fetchTrending(options?: FetchOptions): Promise<DiscoveryItem[]> {
    const limit = options?.limit ?? 30;

    const topIds = (
      await fetchJson("hn:topstories", `${HN_API}/topstories.json`, hnTopStoriesSchema)
    ).slice(0, limit);

    // Promise.allSettled so one slow/failing item doesn't block the batch.
    const settled = await Promise.allSettled(topIds.map(fetchItem));
    const items = settled.map((s) => (s.status === "fulfilled" ? s.value : null));

    return items
      .filter((item): item is HNItem => item !== null && item.type === "story")
      .map((item) => ({
        id: `hn-${item.id}`,
        platform: "hackernews" as const,
        title: item.title,
        url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
        score: item.score,
        commentCount: item.descendants,
        commentsUrl: `https://news.ycombinator.com/item?id=${item.id}`,
        author: item.by,
        createdAt: new Date(item.time * 1000).toISOString(),
        tags: [],
        metadata: {},
      }));
  },
};
