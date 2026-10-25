import { z } from "zod";

import { getEnv } from "@/lib/env";
import { fetchWithRetry } from "@/lib/platforms/fetch-with-retry";
import { USER_AGENT, conditionalRequestHeaders } from "@/lib/rss/fetcher";
import { runtimeName, versionsIn, type RuntimeItemMeta } from "@/lib/runtime-security";
import { parseDate } from "@/lib/text";

import type { CollectedItem, SourceFetchOutcome, SourceToFetch } from "./fetch-source";
import { contentHash } from "./fetch-source";

// GitHub repository security advisories as a source: the public
// `GET /repos/{owner}/{repo}/security-advisories` list (fixed host, so
// fetchWithRetry). Each published advisory becomes one item with its GHSA id as
// guid and the severity, CVE ids and fixed versions in `Item.metadata`.

const API_HOST = "https://api.github.com";
const URL_RE =
  /^https:\/\/api\.github\.com\/repos\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/security-advisories$/;
/** Newest first; advisories older than the first page are history, not news. */
const PAGE_SIZE = 30;
const TEXT_CHARS = 20_000;

export function advisoriesUrl(owner: string, repo: string): string {
  return `${API_HOST}/repos/${owner}/${repo}/security-advisories`;
}

/** "https://api.github.com/repos/php/php-src/security-advisories" -> "php/php-src". */
export function advisoryRepoSlug(url: string): string | null {
  const m = URL_RE.exec(url);
  return m ? `${m[1]}/${m[2]}` : null;
}

const advisorySchema = z
  .object({
    ghsa_id: z.string(),
    cve_id: z.string().nullable().optional(),
    html_url: z.string(),
    summary: z.string(),
    description: z.string().nullable().optional(),
    severity: z.string().nullable().optional(),
    identifiers: z.array(z.object({ type: z.string(), value: z.string() })).default([]),
    state: z.string().optional(),
    published_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    withdrawn_at: z.string().nullable().optional(),
    vulnerabilities: z
      .array(
        z
          .object({
            package: z.object({ ecosystem: z.string(), name: z.string() }).nullable().optional(),
            vulnerable_version_range: z.string().nullable().optional(),
            patched_versions: z.string().nullable().optional(),
          })
          .loose()
      )
      .nullable()
      .optional(),
    cvss_severities: z
      .object({
        cvss_v3: z
          .object({ score: z.number().nullable().optional() })
          .loose()
          .nullable()
          .optional(),
        cvss_v4: z
          .object({ score: z.number().nullable().optional() })
          .loose()
          .nullable()
          .optional(),
      })
      .loose()
      .nullable()
      .optional(),
    cvss: z.object({ score: z.number().nullable().optional() }).loose().nullable().optional(),
  })
  .loose();

export const advisoryListSchema = z.array(advisorySchema);
export type GithubAdvisory = z.infer<typeof advisorySchema>;

function cvssScore(a: GithubAdvisory): number | null {
  return (
    a.cvss_severities?.cvss_v4?.score ?? a.cvss_severities?.cvss_v3?.score ?? a.cvss?.score ?? null
  );
}

export function advisoryMeta(a: GithubAdvisory): RuntimeItemMeta {
  const cveIds = [
    ...new Set(
      [a.cve_id, ...a.identifiers.filter((i) => i.type === "CVE").map((i) => i.value)].filter(
        (v): v is string => Boolean(v)
      )
    ),
  ];
  const affected = (a.vulnerabilities ?? []).map((v) => ({
    package: v.package ? `${v.package.ecosystem}/${v.package.name}` : "",
    vulnerable: v.vulnerable_version_range ?? null,
    patched: v.patched_versions ?? null,
  }));
  const fixed = [...new Set(affected.flatMap((v) => (v.patched ? versionsIn(v.patched) : [])))];
  return {
    kind: "advisory",
    ghsaId: a.ghsa_id,
    ...(a.updated_at ? { updatedAt: a.updated_at } : {}),
    cveIds,
    severity: a.severity ? a.severity.toLowerCase() : null,
    cvssScore: cvssScore(a),
    fixedVersions: fixed,
    affected,
  };
}

/** Published, not withdrawn advisories as items; `runtime` names the title ("PHP security advisory: ..."). */
export function advisoriesToItems(
  advisories: readonly GithubAdvisory[],
  runtime: string | null
): CollectedItem[] {
  const label = runtime ? `${runtimeName(runtime)} security advisory` : "Security advisory";
  return advisories
    .filter((a) => (a.state ?? "published") === "published" && !a.withdrawn_at)
    .map((a) => {
      const meta = advisoryMeta(a);
      const ids = meta.cveIds.length > 0 ? meta.cveIds.join(", ") : a.ghsa_id;
      const title = `${label}: ${a.summary.trim()} (${ids})`;
      return {
        guid: a.ghsa_id,
        title,
        url: a.html_url,
        publishedAt: parseDate(a.published_at ?? null),
        rawText: (a.description ?? "").replace(/\r\n/g, "\n").slice(0, TEXT_CHARS),
        contentHash: contentHash(a.html_url, title),
        metadata: meta,
      };
    });
}

export async function fetchAdvisories(
  source: SourceToFetch & { runtime?: string | null }
): Promise<SourceFetchOutcome> {
  if (!advisoryRepoSlug(source.url)) {
    return { status: "error", httpStatus: null, error: "not a GitHub security-advisories URL" };
  }
  const token = getEnv().GITHUB_TOKEN;
  try {
    const res = await fetchWithRetry(
      `${source.url}?state=published&sort=published&direction=desc&per_page=${PAGE_SIZE}`,
      {
        timeoutMs: 15_000,
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": USER_AGENT,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...conditionalRequestHeaders(source),
        },
      }
    );
    if (res.status === 304) return { status: "not_modified", httpStatus: 304 };
    if (!res.ok) return { status: "error", httpStatus: res.status, error: `HTTP ${res.status}` };
    const parsed = advisoryListSchema.safeParse(await res.json());
    if (!parsed.success) {
      return { status: "error", httpStatus: res.status, error: "invalid advisories response" };
    }
    return {
      status: "ok",
      items: advisoriesToItems(parsed.data, source.runtime ?? null),
      etag: res.headers.get("etag"),
      lastModified: res.headers.get("last-modified"),
      httpStatus: res.status,
    };
  } catch (err) {
    return {
      status: "error",
      httpStatus: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
