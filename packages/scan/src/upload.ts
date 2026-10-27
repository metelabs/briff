import { randomUUID } from "node:crypto";

import type { RepoSource } from "./args";
import type { ScanRepoPayload } from "./collect";
import { SCANNER_VERSION } from "./version";

export interface RepoResult {
  name: string;
  created: boolean;
  dependencies: number;
  direct: number;
  runtimes?: number | null;
}

export type FetchLike = (input: URL, init: RequestInit) => Promise<Response>;

/**
 * Uploads in chunks. Every upload of a run shares `scanId` and the last one says
 * `final: true`, so Briff runs the runtime security rematch and urgent email once, after
 * the whole run (docs/SCANNER.md).
 */
export async function uploadRepos(
  payloads: ScanRepoPayload[],
  options: {
    apiUrl: string;
    token: string;
    source: RepoSource;
    chunk: number;
    fetch?: FetchLike;
  }
): Promise<RepoResult[]> {
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const scanId = randomUUID();
  const results: RepoResult[] = [];
  let capacityError: string | undefined;
  for (let i = 0; i < payloads.length; i += options.chunk) {
    const repos = payloads.slice(i, i + options.chunk);
    const final = i + options.chunk >= payloads.length;
    const res = await doFetch(new URL("/api/scan", options.apiUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.token}`,
        "user-agent": `briff-scan/${SCANNER_VERSION}`,
      },
      body: JSON.stringify({ source: options.source, repos, scanId, final }),
      signal: AbortSignal.timeout(120_000),
    });
    const text = await res.text();
    if (!res.ok) {
      const message = `POST /api/scan -> HTTP ${res.status}: ${text.slice(0, 500)}`;
      if (res.status === 409 && isCapacityResponse(text)) {
        capacityError = message;
        continue;
      }
      throw new Error(message);
    }
    results.push(...(JSON.parse(text) as { repos: RepoResult[] }).repos);
  }
  if (capacityError) throw new Error(capacityError);
  return results;
}

function isCapacityResponse(text: string): boolean {
  try {
    const body: unknown = JSON.parse(text);
    return (
      typeof body === "object" && body !== null && "code" in body && body.code === "REPO_LIMIT"
    );
  } catch {
    return false;
  }
}
