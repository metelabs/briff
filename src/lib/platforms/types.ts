// Discovery platforms (Hacker News, GitHub trending, Product Hunt) are a Phase 2
// "discovery bucket" source; ported from an earlier feed aggregator with its item shape.

export type DiscoveryPlatform = "hackernews" | "github" | "producthunt";

export interface DiscoveryItemMetadata {
  language?: string;
  stars?: number;
  forks?: number;
  description?: string;
  tagline?: string;
  votesCount?: number;
  thumbnail?: string;
}

export interface DiscoveryItem {
  id: string;
  platform: DiscoveryPlatform;
  title: string;
  url: string;
  score: number;
  commentCount: number;
  commentsUrl: string | null;
  author: string | null;
  createdAt: string; // ISO date string
  tags: string[];
  metadata: DiscoveryItemMetadata;
}

export interface PlatformFetcher {
  platform: DiscoveryPlatform;
  fetchTrending(options?: FetchOptions): Promise<DiscoveryItem[]>;
}

export interface FetchOptions {
  limit?: number;
  tags?: string[];
  languages?: string[];
}
