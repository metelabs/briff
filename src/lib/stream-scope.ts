import "server-only";

import { cookies } from "next/headers";

import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";

// The stream picker in the top bar is a scope, not a page: the chosen stream id lives in
// a cookie and pages that show repo data (Alerts, Stack, Repos) read it. A missing or
// stale cookie falls back to the first stream.

export const STREAM_COOKIE = "briff-stream";

export interface StreamOption {
  id: string;
  name: string;
  slug: string;
  repoCount: number;
}

export interface StreamScope {
  streams: StreamOption[];
  current: StreamOption | null;
}

export async function loadStreamScope(orgId: string): Promise<StreamScope> {
  const [jar, rows] = await Promise.all([
    cookies(),
    withOrg(getDb(), orgId).bulletinStream.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, slug: true, _count: { select: { repos: true } } },
    }),
  ]);
  const streams = rows.map((s) => ({
    id: s.id,
    name: s.name,
    slug: s.slug,
    repoCount: s._count.repos,
  }));
  const chosen = jar.get(STREAM_COOKIE)?.value;
  return { streams, current: streams.find((s) => s.id === chosen) ?? streams[0] ?? null };
}

/**
 * Prisma `repo` filter for the scope: the current stream's repos, or every included
 * repo when the org has no stream yet.
 */
export function repoScope(
  scope: Pick<StreamScope, "current">
): { streams: { some: { streamId: string } } } | { included: true } {
  return scope.current ? { streams: { some: { streamId: scope.current.id } } } : { included: true };
}
